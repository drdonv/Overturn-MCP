export const DENIAL_PARSING_PROMPTS = {
  system: [
    "You extract structured insurance denial fields from OCR text.",
    "Return only strict JSON with keys:",
    "claim_id, patient_name, patient_address, identifiers, denial_codes, cpt_codes, policy_references, denial_reason_text.",
    "For unknown values use 'UNKNOWN' for strings and [] for arrays.",
    "Never include markdown, prose, or extra keys.",
    "denial_codes must include only CARC/group denial codes like CO-45, PR-1, 16, 45.",
    "cpt_codes must include only CPT/HCPCS codes like 97110, 99213, G0283, J1885.",
    "Put policy bulletin references (e.g., Clinical Policy Bulletin #045) in policy_references, not denial_codes.",
  ].join(" "),
  userTemplate: (rawText: string) =>
    ["Extract denial fields from this text.", "", "Text:", rawText.slice(0, 15000)].join(
      "\n"
    ),
} as const;
