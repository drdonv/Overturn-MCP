import { z } from "zod";

export const extractClaimDataSchema = z.object({
  file_path: z
    .string()
    .min(1)
    .describe("Absolute or workspace-relative path to the denial PDF file"),
});

export const analyzeDenialCodesSchema = z.object({
  denial_codes: z
    .array(z.string().min(1))
    .min(1)
    .describe("Array of payer denial codes, e.g. ['CO-45', '16']"),
});

export const generateAppealDraftSchema = z.object({
  original_claim_id: z.string().min(1),
  denial_reason: z.string().min(1),
  clinical_justification_text: z.string().min(1),
});

export const extractAndAnalyzeDenialSchema = z.object({
  file_path: z
    .string()
    .min(1)
    .describe("Absolute or workspace-relative path to the denial PDF file"),
});

export const identifierSchema = z.object({
  label: z.string(),
  value: z.string(),
});

export const parsedDenialFieldsSchema = z.object({
  claim_id: z.string().default("UNKNOWN"),
  patient_name: z.string().default("UNKNOWN"),
  patient_address: z.string().default("UNKNOWN"),
  identifiers: z.array(identifierSchema).default([]),
  denial_codes: z.array(z.string()).default([]),
  cpt_codes: z.array(z.string()).default([]),
  policy_references: z.array(z.string()).default([]),
  denial_reason_text: z.string().default("Reason not clearly found in document."),
});

export type ParsedDenialFields = z.infer<typeof parsedDenialFieldsSchema>;
