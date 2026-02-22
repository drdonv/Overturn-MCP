import Anthropic from "@anthropic-ai/sdk";

import {
  DenialMapping,
  denialKnowledgeBase,
  appealStrategyByDenialCategory,
} from "../constants/denial.js";
import { normalizeCode } from "../utils/normalization.js";
import type { GenerateAppealDraftInput } from "../schemas/tool-schemas.js";

export class AppealGenerationService {
  private claudeClient: Anthropic | null;

  constructor() {
    this.claudeClient = process.env.ANTHROPIC_API_KEY
      ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
      : null;
  }

  async generateAppealDraft(input: GenerateAppealDraftInput): Promise<string> {
    const ragContext = this.buildRagContext(input);
    const baseLetter = this.buildTemplateLetter(input);

    if (input.use_ai_enhancement !== false && this.claudeClient) {
      return this.enhanceWithClaude(baseLetter, ragContext, input);
    }

    return baseLetter;
  }

  private buildRagContext(input: GenerateAppealDraftInput): string {
    const sections: string[] = [];

    if (input.denial_codes?.length) {
      sections.push("=== DENIAL CODE REFERENCE ===");
      for (const code of input.denial_codes) {
        const normalized = normalizeCode(code);
        const mapping =
          DenialMapping[normalized as keyof typeof DenialMapping];
        const kb = denialKnowledgeBase[normalized];

        if (mapping) {
          sections.push(
            `Code ${code} (${mapping.title}):`,
            `  Explanation: ${mapping.explanation}`,
            `  Recommended Action: ${mapping.recommendedAction}`
          );
        }
        if (kb) {
          sections.push(`  Knowledge Base: ${kb}`);
        }
        sections.push("");
      }
    }

    const category = this.inferDenialCategory(input);
    if (category) {
      const strategy = appealStrategyByDenialCategory[category];
      if (strategy) {
        sections.push(`=== APPEAL STRATEGY: ${strategy.category} ===`);
        sections.push("Key Arguments:");
        for (const arg of strategy.keyArguments) {
          sections.push(`  - ${arg}`);
        }
        sections.push("Required Evidence:");
        for (const ev of strategy.requiredEvidence) {
          sections.push(`  - ${ev}`);
        }
        sections.push("Regulatory References:");
        for (const ref of strategy.regulatoryReferences) {
          sections.push(`  - ${ref}`);
        }
        sections.push("");
      }
    }

    if (input.denial_code_analysis?.length) {
      sections.push("=== DENIAL CODE ANALYSIS (from extraction) ===");
      for (const analysis of input.denial_code_analysis) {
        sections.push(`  - ${analysis}`);
      }
      sections.push("");
    }

    if (input.policy_references?.length) {
      sections.push("=== POLICY REFERENCES ===");
      for (const ref of input.policy_references) {
        sections.push(`  - ${ref}`);
      }
      sections.push("");
    }

    if (input.cpt_codes?.length) {
      sections.push(
        `=== CPT/HCPCS CODES ===`,
        `Codes: ${input.cpt_codes.join(", ")}`,
        ""
      );
    }

    return sections.join("\n");
  }

  private inferDenialCategory(
    input: GenerateAppealDraftInput
  ): string | null {
    const codes = input.denial_codes ?? [];
    const reason = (input.denial_reason_text ?? "").toLowerCase();

    const medNecCodes = ["50", "55", "49"];
    const authCodes = ["39", "136", "197"];
    const codingCodes = ["4", "5", "6", "9", "11", "16", "97", "236"];
    const eligibilityCodes = ["22", "26", "27", "31", "32"];
    const timelyFilingCodes = ["29"];
    const benefitLimitCodes = ["35", "119", "204"];
    const experimentalCodes = ["55"];

    for (const code of codes) {
      const n = normalizeCode(code);
      if (experimentalCodes.includes(n)) return "experimental";
      if (medNecCodes.includes(n)) return "medical_necessity";
      if (authCodes.includes(n)) return "prior_authorization";
      if (codingCodes.includes(n)) return "coding";
      if (eligibilityCodes.includes(n)) return "eligibility";
      if (timelyFilingCodes.includes(n)) return "timely_filing";
      if (benefitLimitCodes.includes(n)) return "benefit_limit";
    }

    if (/medical.?necessity|not.?medically.?necessary/i.test(reason))
      return "medical_necessity";
    if (/prior.?auth|pre.?cert|authorization/i.test(reason))
      return "prior_authorization";
    if (/timely.?filing|filing.?limit/i.test(reason))
      return "timely_filing";
    if (/experimental|investigational/i.test(reason))
      return "experimental";
    if (/eligib|coverage.?termin|not.?covered/i.test(reason))
      return "eligibility";
    if (/benefit.?max|limit.?reached/i.test(reason))
      return "benefit_limit";

    return null;
  }

  private buildTemplateLetter(input: GenerateAppealDraftInput): string {
    const today = new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const patientName = input.patient_name || "[Patient Name]";
    const patientAddress = input.patient_address || "[Patient Address]";
    const claimId = input.claim_id || "[Claim ID]";
    const insuranceName =
      input.insurance_company_name || "[Insurance Company Name]";
    const insuranceAddress =
      input.insurance_company_address ||
      "[Insurance Company Address Line 1]\n[Insurance Company Address Line 2]";
    const phone = input.phone_number || "[Phone Number]";
    const email = input.email_address || "[Email Address]";

    const identifiersBlock =
      input.identifiers?.length
        ? input.identifiers
            .map((id) => `- ${id.label}: ${id.value}`)
            .join("\n")
        : "- [No identifiers provided]";

    const denialCodesBlock =
      input.denial_codes?.length
        ? input.denial_codes.map((code) => `- ${code}`).join("\n")
        : "- [No denial codes provided]";

    const denialReasonText =
      input.denial_reason_text ||
      "[Denial reason not provided]";

    const denialCodeAnalysisBlock =
      input.denial_code_analysis?.length
        ? input.denial_code_analysis
            .map((explanation) => `- ${explanation}`)
            .join("\n")
        : this.buildDenialCodeAnalysisFromCodes(input.denial_codes);

    const extractionNotesBlock = input.extraction_notes
      ? [
          `- Patient Name Found: ${input.extraction_notes.patient_name_found ?? "N/A"}`,
          `- Patient Address Found: ${input.extraction_notes.patient_address_found ?? "N/A"}`,
          `- Identifiers Found: ${input.extraction_notes.identifiers_found ?? "N/A"}`,
          `- Claim ID Found: ${input.extraction_notes.claim_id_found ?? "N/A"}`,
          `- Denial Codes Found: ${input.extraction_notes.denial_codes_found ?? "N/A"}`,
          `- Denial Reason Found: ${input.extraction_notes.denial_reason_found ?? "N/A"}`,
        ].join("\n")
      : "- [No extraction notes available]";

    const clinicalContext = input.clinical_justification_text
      ? input.clinical_justification_text
      : `The patient, ${patientName}, has been under active medical care for the condition related to this claim. The treating provider has determined that the service rendered was medically necessary and appropriate given the patient's diagnosis, symptoms, and treatment history. Supporting documentation, including the Letter of Medical Necessity and relevant medical records, has been included for your review.`;

    return `${today}

${insuranceName}
Appeals and Grievances Department
${insuranceAddress}

RE: Appeal of Denied Claim
Patient Name: ${patientName}
Patient Address: ${patientAddress}
Claim ID: ${claimId}

Identifiers:
${identifiersBlock}

To Whom It May Concern:

I am writing to formally appeal the denial of coverage for the above-referenced claim.

According to the Explanation of Benefits, this claim (Claim ID: ${claimId}) was denied for the following reason(s):

Denial Codes:
${denialCodesBlock}

Denial Reason as Stated:
"${denialReasonText}"

Denial Code Analysis (Human-Readable Interpretation):
${denialCodeAnalysisBlock}

Based on the documentation provided and the clinical circumstances surrounding this claim, the denial appears to be inconsistent with the applicable coverage criteria and medical necessity standards.

Clinical Context:
${clinicalContext}

Grounds for Appeal:

1. The denial reason cited does not fully account for the documented clinical findings and prior treatment history.
2. The applicable denial code interpretation suggests an administrative or documentation-based issue rather than a lack of medical necessity.
3. All required identifiers and claim information are clearly provided above to ensure accurate review.

Attached Documentation:
- Letter of Medical Necessity
- Relevant Progress Notes
- Procedure Documentation
- Supporting Clinical Literature (if applicable)
- Copy of Explanation of Benefits

Trust & Extraction Verification (for internal review alignment):

Extraction Notes:
${extractionNotesBlock}

All extracted identifiers and claim data have been included to ensure precise matching of this appeal to the correct member account and claim record.

I respectfully request a comprehensive reconsideration of this claim in light of the enclosed documentation and clarification of the denial rationale. If additional information is required, please contact me at the phone number on file or reach out directly to the treating provider listed in the medical documentation.

Thank you for your prompt attention to this matter. I look forward to your timely response and a favorable resolution.

Sincerely,

${patientName}
${patientAddress}
${phone}
${email}`;
  }

  private buildDenialCodeAnalysisFromCodes(
    codes: string[] | undefined
  ): string {
    if (!codes?.length) return "- [No denial code analysis available]";

    const analyses: string[] = [];
    for (const code of codes) {
      const normalized = normalizeCode(code);
      const mapping =
        DenialMapping[normalized as keyof typeof DenialMapping];
      if (mapping) {
        analyses.push(`- ${code}: ${mapping.title} — ${mapping.explanation}`);
      } else {
        analyses.push(
          `- ${code}: Code not found in local CARC dictionary`
        );
      }
    }
    return analyses.join("\n");
  }

  private async enhanceWithClaude(
    baseLetter: string,
    ragContext: string,
    input: GenerateAppealDraftInput
  ): Promise<string> {
    if (!this.claudeClient) return baseLetter;

    const systemPrompt = `You are an expert medical insurance appeal letter writer. You help patients and providers craft compelling, well-structured appeal letters for denied insurance claims.

Your role:
1. Take the base appeal letter template provided and ENHANCE it using the RAG context (denial code knowledge base, appeal strategies, regulatory references).
2. Keep the same structural format of the letter — do NOT change the overall layout or remove sections.
3. Strengthen the "Grounds for Appeal" section with specific, evidence-based arguments drawn from the denial code analysis and appeal strategy context.
4. Make the "Clinical Context" section more compelling if clinical justification was provided.
5. Add relevant regulatory references where appropriate (e.g., ERISA, ACA, state insurance laws).
6. Ensure the tone is professional, assertive but respectful, and legally sound.
7. Do NOT hallucinate facts. Only use information from the provided context and input fields.
8. Do NOT add placeholder text like [insert X here] — if information is missing, write around it gracefully.
9. Return ONLY the final letter text. No markdown headers, no commentary, no explanations outside the letter.

${input.custom_instructions ? `\nAdditional instructions from the user:\n${input.custom_instructions}` : ""}`;

    const userMessage = `Here is the base appeal letter to enhance:

---BASE LETTER---
${baseLetter}
---END BASE LETTER---

Here is the RAG context with denial code knowledge, appeal strategies, and regulatory references:

---RAG CONTEXT---
${ragContext}
---END RAG CONTEXT---

Please enhance this appeal letter using the RAG context. Strengthen the arguments, add regulatory references where relevant, and make it more compelling. Keep the same overall structure and format.`;

    try {
      const response = await this.claudeClient.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        messages: [{ role: "user", content: userMessage }],
        system: systemPrompt,
      });

      const textContent = response.content.find((c) => c.type === "text");
      if (textContent && textContent.type === "text") {
        return textContent.text;
      }
      return baseLetter;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `[appeal-generation] Claude enhancement failed, using template: ${message}\n`
      );
      return baseLetter;
    }
  }
}
