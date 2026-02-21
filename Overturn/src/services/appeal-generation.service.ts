import type { z } from "zod";

import { generateAppealDraftSchema } from "../schemas/tool-schemas";

export class AppealGenerationService {
  generateAppealDraft(input: z.infer<typeof generateAppealDraftSchema>): string {
    const today = new Date().toISOString().slice(0, 10);
    return [
      `# Appeal Letter - Claim ${input.original_claim_id}`,
      "",
      `**Date:** ${today}`,
      `**Claim ID:** ${input.original_claim_id}`,
      "",
      "To: Claims Review Department",
      "",
      "## Re: Request for Reconsideration",
      "",
      `I am writing to formally appeal the denial of claim **${input.original_claim_id}**.`,
      "",
      "### Denial Reason Cited by Payer",
      input.denial_reason,
      "",
      "### Clinical Justification",
      input.clinical_justification_text,
      "",
      "### Request",
      "Based on the documentation and clinical rationale above, please reconsider and reprocess this claim for payment.",
      "",
      "Sincerely,",
      "",
      "[Provider Name]",
      "[Title]",
      "[Organization]",
    ].join("\n");
  }
}
