import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";

import { DENIAL_PARSING_PROMPTS } from "../constants/prompts";
import {
  parsedDenialFieldsSchema,
  type ParsedDenialFields,
} from "../schemas/tool-schemas";

export class LlmDenialParsingService {
  private readonly model: string;
  private readonly client: GoogleGenerativeAI | null;
  private readonly claudeClient: Anthropic | null;

  constructor() {
    const useClaudeParser = process.env.USE_CLAUDE_PARSER === "true";

    this.model = process.env.GEMINI_MODEL ?? "gemini-3-flash-preview";
    this.client = process.env.GEMINI_API_KEY
      ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
      : null;
    this.claudeClient =
      useClaudeParser && process.env.ANTHROPIC_API_KEY
        ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
        : null;
  }

  async parseFromRawText(rawText: string) {
    if (!this.client) {
      throw new Error(
        "GEMINI_API_KEY is not set. Configure it in your .env file."
      );
    }

    const model = this.client.getGenerativeModel({
      model: this.model,
      generationConfig: {
        temperature: 0,
      },
    });

    const prompt = [
      DENIAL_PARSING_PROMPTS.system,
      "",
      DENIAL_PARSING_PROMPTS.userTemplate(rawText),
      "",
      "Return JSON only.",
    ].join("\n");

    const response = await model.generateContent(prompt);
    const textBlocks = response.response.text();

    if (!textBlocks) {
      throw new Error("Gemini returned an empty parsing response.");
    }

    const parsedJson = this.extractJsonObject(textBlocks);
    const normalizedFields = this.normalizeModelOutput(parsedJson);
    const parsedFields = parsedDenialFieldsSchema.parse(normalizedFields);

    return {
      ...parsedFields,
      denial_codes: Array.from(
        new Set(parsedFields.denial_codes.map((code) => code.trim()).filter(Boolean))
      ),
      cpt_codes: Array.from(
        new Set(parsedFields.cpt_codes.map((code) => code.trim()).filter(Boolean))
      ),
      extraction_notes: {
        claim_id_found: parsedFields.claim_id !== "UNKNOWN",
        patient_name_found: parsedFields.patient_name !== "UNKNOWN",
        patient_address_found: parsedFields.patient_address !== "UNKNOWN",
        identifiers_found: parsedFields.identifiers.length > 0,
        denial_codes_found: parsedFields.denial_codes.length > 0,
        cpt_codes_found: parsedFields.cpt_codes.length > 0,
        denial_reason_found:
          parsedFields.denial_reason_text !==
          "Reason not clearly found in document.",
      },
    };
  }

  private extractJsonObject(textContent: string): unknown {
    const firstBrace = textContent.indexOf("{");
    const lastBrace = textContent.lastIndexOf("}");
    if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
      throw new Error("Gemini response did not contain a valid JSON object.");
    }
    const candidate = textContent.slice(firstBrace, lastBrace + 1);
    return JSON.parse(candidate);
  }

  private normalizeModelOutput(raw: unknown): ParsedDenialFields {
    const input = this.ensureRecord(raw);

    const normalizedIdentifiers = this.normalizeIdentifiers(input.identifiers);
    const { denialCodes, policyReferencesFromCodes } = this.normalizeDenialCodes(
      input.denial_codes
    );
    const explicitPolicyReferences = this.normalizeStringArray(
      input.policy_references
    );

    return {
      claim_id: this.toKnownString(input.claim_id),
      patient_name: this.toKnownString(input.patient_name),
      patient_address: this.toKnownString(input.patient_address),
      identifiers: normalizedIdentifiers,
      denial_codes: denialCodes,
      cpt_codes: this.normalizeCptCodes(input.cpt_codes),
      policy_references: Array.from(
        new Set([...explicitPolicyReferences, ...policyReferencesFromCodes])
      ),
      denial_reason_text: this.toKnownString(
        input.denial_reason_text,
        "Reason not clearly found in document."
      ),
    };
  }

  private ensureRecord(value: unknown): Record<string, unknown> {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return {};
  }

  private toKnownString(value: unknown, fallback = "UNKNOWN"): string {
    if (typeof value !== "string") {
      return fallback;
    }
    const cleaned = value.trim();
    return cleaned.length > 0 ? cleaned : fallback;
  }

  private normalizeDenialCodes(value: unknown): {
    denialCodes: string[];
    policyReferencesFromCodes: string[];
  } {
    const rawValues = this.normalizeStringArray(value);
    const denialCodes: string[] = [];
    const policyReferencesFromCodes: string[] = [];

    for (const entry of rawValues) {
      if (this.isCarcLikeCode(entry)) {
        denialCodes.push(entry);
      } else {
        policyReferencesFromCodes.push(entry);
      }
    }

    return {
      denialCodes: Array.from(new Set(denialCodes)),
      policyReferencesFromCodes: Array.from(new Set(policyReferencesFromCodes)),
    };
  }

  private normalizeStringArray(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value
        .map((item) =>
          typeof item === "string" ? item.trim() : String(item ?? "").trim()
        )
        .filter(Boolean);
    }
    if (typeof value === "string") {
      return value
        .split(/[,\n;]/)
        .map((item) => item.trim())
        .filter(Boolean);
    }
    return [];
  }

  private normalizeCptCodes(value: unknown): string[] {
    const rawValues = this.normalizeStringArray(value);
    const extracted = new Set<string>();
    const codeRegex = /\b(?:[A-Z]\d{4}|\d{5})\b/g;
    for (const entry of rawValues) {
      for (const match of entry.toUpperCase().matchAll(codeRegex)) {
        extracted.add(match[0]);
      }
    }
    return Array.from(extracted);
  }

  private isCarcLikeCode(code: string): boolean {
    const cleaned = code.toUpperCase().split(/\s+/).join("");
    if (/^(CO|PR|OA|PI)-?\d{1,3}$/.test(cleaned)) {
      return true;
    }
    if (/^\d{1,3}$/.test(cleaned)) {
      return true;
    }
    if (/^CARC[:#-]?\d{1,3}$/.test(cleaned)) {
      return true;
    }
    return false;
  }

  private normalizeIdentifiers(
    value: unknown
  ): Array<{ label: string; value: string }> {
    if (!Array.isArray(value)) {
      return [];
    }

    const mapped = value
      .map((item) => this.normalizeIdentifierEntry(item))
      .filter((item): item is { label: string; value: string } => item !== null);

    const deduped = new Map<string, { label: string; value: string }>();
    for (const item of mapped) {
      deduped.set(`${item.label}:${item.value}`, item);
    }
    return Array.from(deduped.values());
  }

  private normalizeIdentifierEntry(
    item: unknown
  ): { label: string; value: string } | null {
    if (typeof item === "string") {
      const parts = item.split(/[:=-]/, 2).map((part) => part.trim());
      if (parts.length === 2 && parts[0] && parts[1]) {
        return {
          label: parts[0].toLowerCase().split(/\s+/).join("_"),
          value: parts[1],
        };
      }
      return null;
    }

    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return null;
    }

    const record = item as Record<string, unknown>;
    const label = this.toKnownString(record.label, "").toLowerCase();
    const value = this.toKnownString(record.value, "");
    if (!label || !value) {
      return null;
    }
    return {
      label: label.split(/\s+/).join("_"),
      value,
    };
  }
}
