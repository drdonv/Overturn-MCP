import { DenialMapping } from "../constants/denial.js";

export class RegexDenialParsingService {
  private readonly claimPatterns = [
    /(?:claim\s*(?:id|number|no\.?|#)\s*[:#-]?\s*)([A-Z0-9-]{5,})/i,
    /(?:control\s*number\s*[:#-]?\s*)([A-Z0-9-]{5,})/i,
  ];

  private readonly denialReasonPattern =
    /(?:denial\s*reason|reason\s*for\s*denial|explanation(?:\s*of\s*benefits)?)[\s:.-]*([\s\S]{0,1200})/i;

  parseFromRawText(rawText: string) {
    const normalizedText = rawText.split("\r").join("\n");
    const claimId = this.extractClaimId(normalizedText);
    const patientName = this.extractPatientName(normalizedText);
    const patientAddress = this.extractPatientAddress(normalizedText);
    const denialCodes = this.extractDenialCodes(normalizedText);
    const cptCodes = this.extractCptCodes(normalizedText);
    const denialReason = this.extractDenialReason(normalizedText);
    const identifiers = this.extractIdentifiers(normalizedText);

    return {
      claim_id: claimId,
      patient_name: patientName,
      patient_address: patientAddress,
      identifiers,
      denial_codes: denialCodes,
      cpt_codes: cptCodes,
      policy_references: [] as string[],
      denial_reason_text: denialReason,
      extraction_notes: {
        claim_id_found: claimId !== "UNKNOWN",
        patient_name_found: patientName !== "UNKNOWN",
        patient_address_found: patientAddress !== "UNKNOWN",
        identifiers_found: identifiers.length > 0,
        denial_codes_found: denialCodes.length > 0,
        cpt_codes_found: cptCodes.length > 0,
        denial_reason_found:
          denialReason !== "Reason not clearly found in document.",
      },
    };
  }

  private extractClaimId(rawText: string): string {
    for (const pattern of this.claimPatterns) {
      const match = pattern.exec(rawText);
      if (match?.[1]) {
        return match[1].trim();
      }
    }
    return "UNKNOWN";
  }

  private extractDenialCodes(rawText: string): string[] {
    const withGroupCode = Array.from(
      rawText.matchAll(/\b(?:CO|PR|OA|PI)\s*-\s*\d{1,3}\b/gi)
    ).map((match) => match[0].split(/\s+/).join(""));

    const knownStandalone = Object.keys(DenialMapping).filter((code) =>
      new RegExp(String.raw`\b${code}\b`).test(rawText)
    );

    return Array.from(new Set([...withGroupCode, ...knownStandalone]));
  }

  private extractCptCodes(rawText: string): string[] {
    const labelledCodes = Array.from(
      rawText.matchAll(
        /\b(?:cpt|hcpcs|procedure\s*code|proc\s*code)\s*[:#-]?\s*([A-Z]?\d{4,5})\b/gi
      )
    ).map((match) => match[1].toUpperCase());
    return Array.from(new Set(labelledCodes));
  }

  private extractDenialReason(rawText: string): string {
    const match = this.denialReasonPattern.exec(rawText);
    const firstParagraph = match?.[1]?.split(/\n{2,}/)[0]?.trim();
    if (firstParagraph && firstParagraph.length >= 20) {
      return firstParagraph;
    }
    return "Reason not clearly found in document.";
  }

  private extractPatientName(rawText: string): string {
    const patterns = [
      /(?:patient\s*name|member\s*name|subscriber\s*name)\s*[:#-]?\s*([A-Z][A-Z ,.'-]{3,})/i,
      /(?:name)\s*[:#-]?\s*([A-Z][A-Z ,.'-]{3,})/i,
    ];
    for (const pattern of patterns) {
      const match = pattern.exec(rawText);
      if (match?.[1]) {
        return this.toTitleCase(match[1].trim());
      }
    }
    return "UNKNOWN";
  }

  private extractPatientAddress(rawText: string): string {
    const lines = rawText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    const zipRegex = /\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/i;
    for (let i = 0; i < lines.length - 1; i += 1) {
      const current = lines[i];
      const next = lines[i + 1];
      if (/\d{1,5}\s+[A-Z0-9 .'-]{3,}/i.test(current) && zipRegex.test(next)) {
        return `${this.toTitleCase(current)}, ${next.toUpperCase()}`;
      }
    }
    return "UNKNOWN";
  }

  private extractIdentifiers(rawText: string): Array<{
    label: string;
    value: string;
  }> {
    const items: Array<{ label: string; value: string }> = [];

    const labelPatterns = [
      String.raw`member\s*id`,
      String.raw`subscriber\s*id`,
      String.raw`account\s*#?`,
      String.raw`policy\s*#?`,
      String.raw`reference\s*#?`,
      String.raw`auth\s*#?`,
      String.raw`authorization\s*#?`,
    ];

    for (const labelPattern of labelPatterns) {
      const regex = new RegExp(
        String.raw`\b(${labelPattern})\s*[:#-]?\s*([A-Z0-9-]{4,})`,
        "gi"
      );
      for (const match of rawText.matchAll(regex)) {
        const label = match[1]?.trim();
        const value = match[2]?.trim();
        if (label && value) {
          items.push({
            label: label.toLowerCase().split(/\s+/).join("_"),
            value,
          });
        }
      }
    }

    const deduped = new Map<string, { label: string; value: string }>();
    for (const item of items) {
      deduped.set(`${item.label}:${item.value}`, item);
    }
    return Array.from(deduped.values());
  }

  private toTitleCase(value: string): string {
    return value
      .toLowerCase()
      .split(/\s+/)
      .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
      .join(" ");
  }
}
