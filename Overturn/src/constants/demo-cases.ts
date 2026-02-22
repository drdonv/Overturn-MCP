export interface DemoCase {
  id: string;
  title: string;
  description: string;
  parsed_fields: {
    claim_id: string;
    patient_name: string;
    patient_address: string;
    identifiers: Array<{ label: string; value: string }>;
    denial_codes: string[];
    cpt_codes: string[];
    policy_references: string[];
    denial_reason_text: string;
    extraction_notes: Record<string, boolean>;
  };
  denial_code_analysis: Array<{
    input_code: string;
    normalized_code: string;
    found: boolean;
    title: string;
    explanation: string;
    recommended_action: string;
  }>;
}

export const DEMO_CASES: DemoCase[] = [
  {
    id: "demo_medical_necessity",
    title: "Medical Necessity Denial — Physical Therapy",
    description:
      "Jane Doe's PT sessions denied after 24 visits. Payer says benefit limit reached (CARC 50, 119).",
    parsed_fields: {
      claim_id: "CLM-2026-88421",
      patient_name: "Jane Doe",
      patient_address: "742 Evergreen Terrace, Springfield, IL 62704",
      identifiers: [
        { label: "member_id", value: "MBR-9920145" },
        { label: "policy_number", value: "GRP-PPO-4410" },
        { label: "authorization_number", value: "AUTH-7756223" },
      ],
      denial_codes: ["CO-50", "119"],
      cpt_codes: ["97110", "97140", "97530"],
      policy_references: ["Clinical Policy Bulletin #045"],
      denial_reason_text:
        "The requested physical therapy services (CPT 97110, 97140, 97530) exceed the benefit plan limit of 24 visits per calendar year. The plan does not cover services beyond this limit. Medical necessity for additional sessions has not been established per Clinical Policy Bulletin #045.",
      extraction_notes: {
        patient_name_found: true,
        patient_address_found: true,
        identifiers_found: true,
        claim_id_found: true,
        denial_codes_found: true,
        denial_reason_found: true,
        cpt_codes_found: true,
      },
    },
    denial_code_analysis: [
      {
        input_code: "CO-50",
        normalized_code: "50",
        found: true,
        title:
          "These are non-covered services because this is not deemed a medical necessity",
        explanation:
          "The payer has determined the service does not meet medical necessity criteria.",
        recommended_action:
          "Submit a detailed Letter of Medical Necessity with clinical records, peer-reviewed literature, and provider attestation.",
      },
      {
        input_code: "119",
        normalized_code: "119",
        found: true,
        title:
          "Benefit maximum for this time period or occurrence has been reached",
        explanation:
          "The patient has used all available benefits for this service category within the time period.",
        recommended_action:
          "Verify benefit limits and usage. If medically necessary beyond limits, appeal with clinical justification.",
      },
    ],
  },
  {
    id: "demo_prior_auth",
    title: "Prior Authorization Denial — MRI",
    description:
      "John Smith's lumbar MRI denied for missing prior authorization (CARC 197).",
    parsed_fields: {
      claim_id: "CLM-2026-77305",
      patient_name: "John Smith",
      patient_address: "1600 Pennsylvania Ave, Washington, DC 20500",
      identifiers: [
        { label: "member_id", value: "MBR-5503217" },
        { label: "subscriber_id", value: "SUB-12098" },
      ],
      denial_codes: ["PR-197"],
      cpt_codes: ["72148"],
      policy_references: [],
      denial_reason_text:
        "Claim denied: prior authorization/pre-certification was not obtained for the MRI lumbar spine without contrast (CPT 72148) performed on 01/15/2026. Per plan requirements, all advanced imaging studies require pre-authorization. Contact the utilization management department for retroactive review.",
      extraction_notes: {
        patient_name_found: true,
        patient_address_found: true,
        identifiers_found: true,
        claim_id_found: true,
        denial_codes_found: true,
        denial_reason_found: true,
        cpt_codes_found: true,
      },
    },
    denial_code_analysis: [
      {
        input_code: "PR-197",
        normalized_code: "197",
        found: true,
        title: "Precertification/authorization/notification/pre-treatment absent",
        explanation:
          "Required prior authorization or notification was not provided.",
        recommended_action:
          "Obtain retroactive auth or provide proof of timely notification. Appeal with emergency/urgent documentation if applicable.",
      },
    ],
  },
  {
    id: "demo_coding_error",
    title: "Coding / Billing Error — Office Visit",
    description:
      "Maria Garcia's office visit denied for diagnosis-procedure mismatch (CARC 11, 16).",
    parsed_fields: {
      claim_id: "CLM-2026-63019",
      patient_name: "Maria Garcia",
      patient_address: "350 Fifth Avenue, New York, NY 10118",
      identifiers: [
        { label: "member_id", value: "MBR-8821034" },
        { label: "account_number", value: "ACCT-44291" },
      ],
      denial_codes: ["CO-11", "CO-16"],
      cpt_codes: ["99214"],
      policy_references: [],
      denial_reason_text:
        "The diagnosis code submitted (Z00.00 - Encounter for general adult medical examination) is inconsistent with the level of service billed (CPT 99214 - Office visit, established patient, moderate complexity). The claim also lacks supporting documentation. Please resubmit with correct diagnosis coding and attach relevant clinical notes.",
      extraction_notes: {
        patient_name_found: true,
        patient_address_found: true,
        identifiers_found: true,
        claim_id_found: true,
        denial_codes_found: true,
        denial_reason_found: true,
        cpt_codes_found: true,
      },
    },
    denial_code_analysis: [
      {
        input_code: "CO-11",
        normalized_code: "11",
        found: true,
        title: "The diagnosis is inconsistent with the procedure",
        explanation:
          "The diagnosis code does not support the medical necessity of the procedure billed.",
        recommended_action:
          "Review diagnosis-procedure pairing, update to the most specific/accurate ICD code, and resubmit.",
      },
      {
        input_code: "CO-16",
        normalized_code: "16",
        found: true,
        title:
          "Claim/service lacks information or has submission/billing error(s)",
        explanation:
          "The payer needs corrected or additional claim information before adjudication can complete.",
        recommended_action:
          "Validate required claim fields, attach missing documentation, and resubmit a corrected claim.",
      },
    ],
  },
];
