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

export const identifierSchema = z.object({
  label: z.string(),
  value: z.string(),
});

export const extractionNotesSchema = z.object({
  patient_name_found: z.boolean().optional(),
  patient_address_found: z.boolean().optional(),
  identifiers_found: z.boolean().optional(),
  claim_id_found: z.boolean().optional(),
  denial_codes_found: z.boolean().optional(),
  denial_reason_found: z.boolean().optional(),
  cpt_codes_found: z.boolean().optional(),
});

export const generateAppealDraftSchema = z.object({
  patient_name: z
    .string()
    .optional()
    .describe("Patient's full name"),
  patient_address: z
    .string()
    .optional()
    .describe("Patient's mailing address"),
  claim_id: z
    .string()
    .optional()
    .describe("The claim ID / claim number from the denial notice"),
  identifiers: z
    .array(identifierSchema)
    .optional()
    .describe("Array of identifier objects with label and value (e.g. member_id, policy_number)"),
  denial_codes: z
    .array(z.string())
    .optional()
    .describe("Array of denial codes from the EOB (e.g. CO-45, PR-1, 96)"),
  denial_reason_text: z
    .string()
    .optional()
    .describe("The denial reason as stated on the EOB"),
  denial_code_analysis: z
    .array(z.string())
    .optional()
    .describe("Human-readable denial code interpretations"),
  cpt_codes: z
    .array(z.string())
    .optional()
    .describe("CPT/HCPCS procedure codes related to the claim"),
  policy_references: z
    .array(z.string())
    .optional()
    .describe("Payer policy references cited in the denial"),
  extraction_notes: z
    .union([extractionNotesSchema, z.record(z.string(), z.boolean())])
    .optional()
    .describe("Notes on which fields were successfully extracted from the denial document"),
  insurance_company_name: z
    .string()
    .optional()
    .describe("Name of the insurance company"),
  insurance_company_address: z
    .string()
    .optional()
    .describe("Full mailing address of the insurance company (can be multi-line)"),
  phone_number: z
    .string()
    .optional()
    .describe("Patient's phone number for correspondence"),
  email_address: z
    .string()
    .optional()
    .describe("Patient's email address for correspondence"),
  clinical_justification_text: z
    .string()
    .optional()
    .describe("Additional clinical context or justification to include in the appeal"),
  custom_instructions: z
    .string()
    .optional()
    .describe("Free-text instructions for Claude to customize the appeal letter tone, focus, or content"),
  use_ai_enhancement: z
    .boolean()
    .optional()
    .default(true)
    .describe("Whether to use Claude AI to enhance the letter with RAG context (requires ANTHROPIC_API_KEY). Defaults to true."),
});

export type GenerateAppealDraftInput = z.infer<typeof generateAppealDraftSchema>;

export const extractAndAnalyzeDenialSchema = z.object({
  file_path: z
    .string()
    .min(1)
    .describe("Absolute or workspace-relative path to the denial PDF file"),
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

export const openOverturnDashboardSchema = z.object({
  initial_file_path: z
    .string()
    .optional()
    .describe("Optional path to a denial PDF to pre-fill the intake field"),
});

export const loadDemoCaseSchema = z.object({
  case_id: z
    .string()
    .optional()
    .describe(
      "ID of a demo case to load. Options: demo_medical_necessity, demo_prior_auth, demo_coding_error. If omitted, returns a list of available demos."
    ),
});
