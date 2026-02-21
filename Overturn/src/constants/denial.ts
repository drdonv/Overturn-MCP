export const DenialMapping = {
  "16": {
    title: "Claim/service lacks information or has submission/billing error(s)",
    explanation:
      "The payer needs corrected or additional claim information before adjudication can complete.",
    recommendedAction:
      "Validate required claim fields, attach missing documentation, and resubmit a corrected claim.",
  },
  "22": {
    title: "This care may be covered by another payer per coordination of benefits",
    explanation:
      "The payer believes another plan should process the claim first.",
    recommendedAction:
      "Confirm primary payer, submit to correct primary insurer, then bill secondary with EOB.",
  },
  "27": {
    title: "Expenses incurred after coverage terminated",
    explanation:
      "Date of service falls outside the patient's active coverage period.",
    recommendedAction:
      "Verify eligibility dates, correct member details if needed, or redirect to self-pay/alternate coverage.",
  },
  "45": {
    title: "Charge exceeds fee schedule/maximum allowable or contracted amount",
    explanation:
      "The billed amount is above contractual or regulatory allowable rates.",
    recommendedAction:
      "Review payer contract terms, reconcile expected allowable, and adjust or appeal as contractually appropriate.",
  },
  "96": {
    title: "Non-covered charge(s)",
    explanation:
      "The service is considered non-covered under the member's plan benefit design.",
    recommendedAction:
      "Review plan exclusions and policy criteria, then submit medical necessity support if an exception is warranted.",
  },
} as const;

export const denialKnowledgeBase: Record<string, string> = {
  "16": "CARC 16 often indicates missing claim data, invalid coding details, or absent documentation required for payment review.",
  "22": "CARC 22 typically points to Coordination of Benefits conflicts where another carrier must adjudicate first.",
  "27": "CARC 27 indicates services rendered after termination of policy coverage or outside active eligibility windows.",
  "45": "CARC 45 is commonly tied to fee schedule reductions, contractual adjustments, or maximum allowable limits.",
  "96": "CARC 96 is used for non-covered services and may require benefit interpretation or exception-based appeal support.",
};
