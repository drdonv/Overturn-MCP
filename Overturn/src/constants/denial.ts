export const DenialMapping: Record<
  string,
  { title: string; explanation: string; recommendedAction: string }
> = {
  "1": {
    title: "Deductible Amount",
    explanation:
      "The charged amount is applied to the patient's deductible, not a claim denial per se.",
    recommendedAction:
      "Verify deductible status with the payer and inform the patient of their financial responsibility.",
  },
  "2": {
    title: "Coinsurance Amount",
    explanation:
      "The amount represents the patient's coinsurance obligation under the plan.",
    recommendedAction:
      "Bill the patient for the coinsurance portion as per plan benefit design.",
  },
  "3": {
    title: "Co-payment Amount",
    explanation:
      "The amount reflects the patient's co-pay responsibility.",
    recommendedAction:
      "Collect co-payment from the patient per the plan schedule.",
  },
  "4": {
    title: "The procedure code is inconsistent with the modifier used",
    explanation:
      "The modifier attached to the procedure code is incompatible or incorrect.",
    recommendedAction:
      "Review modifier usage against payer guidelines and resubmit with the correct modifier.",
  },
  "5": {
    title: "The procedure code/bill type is inconsistent with the place of service",
    explanation:
      "The place of service does not match the procedure or billing type submitted.",
    recommendedAction:
      "Verify place of service code, correct if needed, and resubmit.",
  },
  "6": {
    title: "The procedure/revenue code is inconsistent with the patient's age",
    explanation:
      "The service billed is not appropriate for the patient's reported age.",
    recommendedAction:
      "Confirm patient demographics are accurate and resubmit or provide supporting documentation.",
  },
  "9": {
    title: "The diagnosis is inconsistent with the patient's age",
    explanation:
      "The diagnosis code does not align with the patient's reported age.",
    recommendedAction:
      "Verify diagnosis and patient age, correct errors, and resubmit.",
  },
  "11": {
    title: "The diagnosis is inconsistent with the procedure",
    explanation:
      "The diagnosis code does not support the medical necessity of the procedure billed.",
    recommendedAction:
      "Review diagnosis-procedure pairing, update to the most specific/accurate ICD code, and resubmit.",
  },
  "16": {
    title: "Claim/service lacks information or has submission/billing error(s)",
    explanation:
      "The payer needs corrected or additional claim information before adjudication can complete.",
    recommendedAction:
      "Validate required claim fields, attach missing documentation, and resubmit a corrected claim.",
  },
  "18": {
    title: "Exact duplicate claim/service",
    explanation:
      "The payer identified this as an identical resubmission of a previously processed claim.",
    recommendedAction:
      "Check if the original claim was paid. If legitimately different, resubmit with distinguishing information.",
  },
  "22": {
    title: "This care may be covered by another payer per coordination of benefits",
    explanation:
      "The payer believes another plan should process the claim first.",
    recommendedAction:
      "Confirm primary payer, submit to correct primary insurer, then bill secondary with EOB.",
  },
  "23": {
    title: "The impact of prior payer(s) adjudication including payments and/or adjustments",
    explanation:
      "The adjustment accounts for what was already paid or adjusted by a prior payer.",
    recommendedAction:
      "Submit with prior payer's EOB/remittance to demonstrate correct coordination of benefits.",
  },
  "24": {
    title: "Charges are covered under a capitation agreement/managed care plan",
    explanation:
      "Services fall under a capitated arrangement and are not separately reimbursable.",
    recommendedAction:
      "Verify capitation contract terms. If service is carved out, provide documentation and appeal.",
  },
  "26": {
    title: "Expenses incurred prior to coverage",
    explanation:
      "The date of service is before the patient's coverage effective date.",
    recommendedAction:
      "Verify eligibility dates and correct if in error, or redirect to alternate coverage.",
  },
  "27": {
    title: "Expenses incurred after coverage terminated",
    explanation:
      "Date of service falls outside the patient's active coverage period.",
    recommendedAction:
      "Verify eligibility dates, correct member details if needed, or redirect to self-pay/alternate coverage.",
  },
  "29": {
    title: "The time limit for filing has expired",
    explanation:
      "The claim was submitted after the payer's filing deadline.",
    recommendedAction:
      "Document timely filing proof (original submission date, receipt confirmation) and appeal with evidence.",
  },
  "31": {
    title: "Patient cannot be identified as our insured",
    explanation:
      "The payer cannot match the patient to an active policy.",
    recommendedAction:
      "Verify subscriber ID, patient name, and DOB. Correct and resubmit with accurate member information.",
  },
  "32": {
    title: "Our records indicate the patient is not an eligible dependent",
    explanation:
      "The patient is not listed as a covered dependent on the subscriber's policy.",
    recommendedAction:
      "Confirm dependent status with the subscriber and payer. Provide enrollment documentation if needed.",
  },
  "35": {
    title: "Lifetime benefit maximum has been reached",
    explanation:
      "The patient has exhausted the lifetime maximum for this benefit category.",
    recommendedAction:
      "Review benefit limits. If an exception applies, submit medical necessity documentation for appeal.",
  },
  "39": {
    title: "Services denied at the time authorization/pre-certification was requested",
    explanation:
      "Pre-authorization was requested and denied for this service.",
    recommendedAction:
      "Review the denial rationale, gather additional clinical documentation, and resubmit the auth request or appeal.",
  },
  "45": {
    title: "Charge exceeds fee schedule/maximum allowable or contracted amount",
    explanation:
      "The billed amount is above contractual or regulatory allowable rates.",
    recommendedAction:
      "Review payer contract terms, reconcile expected allowable, and adjust or appeal as contractually appropriate.",
  },
  "49": {
    title: "This is a non-covered service because it is a routine/preventive exam",
    explanation:
      "The service is classified as routine/preventive and is not covered under the plan or was billed incorrectly.",
    recommendedAction:
      "Verify if the service qualifies for preventive benefits. If medically necessary beyond screening, re-code and appeal.",
  },
  "50": {
    title: "These are non-covered services because this is not deemed a medical necessity",
    explanation:
      "The payer has determined the service does not meet medical necessity criteria.",
    recommendedAction:
      "Submit a detailed Letter of Medical Necessity with clinical records, peer-reviewed literature, and provider attestation.",
  },
  "55": {
    title: "Procedure/treatment/drug is deemed experimental or investigational",
    explanation:
      "The payer considers the treatment experimental and excludes it from coverage.",
    recommendedAction:
      "Provide clinical evidence, FDA approvals, published studies, and peer-reviewed support for the treatment's efficacy.",
  },
  "96": {
    title: "Non-covered charge(s)",
    explanation:
      "The service is considered non-covered under the member's plan benefit design.",
    recommendedAction:
      "Review plan exclusions and policy criteria, then submit medical necessity support if an exception is warranted.",
  },
  "97": {
    title: "The benefit for this service is included in the payment/allowance for another service",
    explanation:
      "The service is bundled with another procedure and not separately payable.",
    recommendedAction:
      "Review bundling/unbundling rules (NCCI edits). If the service is distinct, append modifier 59 or XE/XS/XP/XU and resubmit.",
  },
  "109": {
    title: "Claim/service not covered by this payer/contractor",
    explanation:
      "The payer does not cover this type of claim or service.",
    recommendedAction:
      "Verify the correct payer and plan. Redirect the claim to the appropriate carrier.",
  },
  "119": {
    title: "Benefit maximum for this time period or occurrence has been reached",
    explanation:
      "The patient has used all available benefits for this service category within the time period.",
    recommendedAction:
      "Verify benefit limits and usage. If medically necessary beyond limits, appeal with clinical justification.",
  },
  "136": {
    title: "Failure to follow prior authorization/pre-certification requirements",
    explanation:
      "Required pre-authorization was not obtained before the service was rendered.",
    recommendedAction:
      "Obtain retroactive authorization if possible. Provide urgency/emergency documentation to justify the lack of prior auth.",
  },
  "151": {
    title: "Payment adjusted because the payer deems the information submitted does not support this many services",
    explanation:
      "The payer considers the volume or frequency of services excessive.",
    recommendedAction:
      "Provide detailed medical records justifying each service instance and medical necessity for the frequency.",
  },
  "167": {
    title: "This (these) diagnosis(es) is (are) not covered",
    explanation:
      "The diagnosis code used is not a covered condition under the plan.",
    recommendedAction:
      "Review diagnosis coding accuracy. If the condition is covered under a different code, correct and resubmit.",
  },
  "197": {
    title: "Precertification/authorization/notification/pre-treatment absent",
    explanation:
      "Required prior authorization or notification was not provided.",
    recommendedAction:
      "Obtain retroactive auth or provide proof of timely notification. Appeal with emergency/urgent documentation if applicable.",
  },
  "204": {
    title: "This service/equipment/drug is not covered under the patient's current benefit plan",
    explanation:
      "The specific service, supply, or drug is excluded from the patient's benefit plan.",
    recommendedAction:
      "Review the benefit plan for covered alternatives. If no alternative exists, appeal with medical necessity documentation.",
  },
  "236": {
    title: "This procedure or procedure/modifier combination is not compatible with another procedure",
    explanation:
      "Conflicting procedure codes or modifier combinations were billed together.",
    recommendedAction:
      "Review coding for NCCI edits and modifier usage. Correct the claim and resubmit.",
  },
  "252": {
    title: "An attachment/other documentation is required to adjudicate this claim",
    explanation:
      "The payer requires additional documentation before the claim can be processed.",
    recommendedAction:
      "Submit the requested attachments (medical records, operative notes, LOMs) and resubmit the claim.",
  },
} as const;

export const denialKnowledgeBase: Record<string, string> = {
  "1": "CARC 1 applies the deductible. Not a true denial but the patient's cost-sharing responsibility. Verify accumulated deductible amounts.",
  "2": "CARC 2 represents coinsurance. The patient's cost-sharing percentage applies after deductible is met.",
  "3": "CARC 3 is the co-payment amount. Standard cost-sharing per the benefit plan.",
  "4": "CARC 4 indicates a modifier mismatch. Common with bilateral procedures, assistant surgeon modifiers, or distinct procedural service modifiers.",
  "5": "CARC 5 flags place of service inconsistency. Verify if the service was performed in the correct setting per payer policy.",
  "6": "CARC 6 flags age-related procedure inconsistency. Pediatric vs adult procedure codes may apply.",
  "9": "CARC 9 indicates the diagnosis doesn't match the patient's age group. Common with age-specific conditions.",
  "11": "CARC 11 means the diagnosis doesn't support the procedure. Medical necessity linkage between ICD and CPT codes is required.",
  "16": "CARC 16 often indicates missing claim data, invalid coding details, or absent documentation required for payment review.",
  "18": "CARC 18 flags exact duplicate submissions. Verify original claim status before resubmitting.",
  "22": "CARC 22 typically points to Coordination of Benefits conflicts where another carrier must adjudicate first.",
  "23": "CARC 23 accounts for prior payer adjudication in coordination of benefits scenarios.",
  "24": "CARC 24 indicates services fall under a capitation arrangement. Check carve-out provisions.",
  "26": "CARC 26 means services were rendered before coverage began. Verify enrollment effective dates.",
  "27": "CARC 27 indicates services rendered after termination of policy coverage or outside active eligibility windows.",
  "29": "CARC 29 is a timely filing denial. Most payers have 90-365 day filing limits. Proof of timely submission is critical for appeal.",
  "31": "CARC 31 means the patient cannot be identified in the payer's system. Verify subscriber ID and demographic information.",
  "32": "CARC 32 flags an ineligible dependent. Confirm dependent enrollment status.",
  "35": "CARC 35 indicates the lifetime maximum has been reached. Exception appeals require strong medical necessity documentation.",
  "39": "CARC 39 means prior auth was denied. Clinical documentation supporting necessity is essential for appeal.",
  "45": "CARC 45 is commonly tied to fee schedule reductions, contractual adjustments, or maximum allowable limits.",
  "49": "CARC 49 denies routine/preventive services. May need to distinguish between diagnostic and screening intent.",
  "50": "CARC 50 is a medical necessity denial. Strong clinical documentation, peer-reviewed evidence, and treatment guidelines are essential for appeal.",
  "55": "CARC 55 flags experimental/investigational services. FDA status, published clinical trials, and professional society guidelines support appeals.",
  "96": "CARC 96 is used for non-covered services and may require benefit interpretation or exception-based appeal support.",
  "97": "CARC 97 indicates bundling. Review NCCI edits and CCI guidelines. Modifier 59 or X{EPSU} modifiers may apply for distinct services.",
  "109": "CARC 109 means the payer doesn't cover this service type. Verify correct payer assignment.",
  "119": "CARC 119 indicates period-based benefit limits are exhausted. Appeals should demonstrate medical necessity beyond plan limits.",
  "136": "CARC 136 is a prior auth failure. Retroactive auth or emergency exception documentation is needed for appeal.",
  "151": "CARC 151 questions service frequency/volume. Medical records must justify each service encounter individually.",
  "167": "CARC 167 flags non-covered diagnoses. Verify ICD-10 coding specificity and accuracy.",
  "197": "CARC 197 flags missing precertification. Similar to 136 but may also include notification requirements.",
  "204": "CARC 204 excludes specific services/drugs from the benefit plan. Check for covered alternatives or formulary exceptions.",
  "236": "CARC 236 flags incompatible procedure combinations. Review NCCI edits for correct code pairing.",
  "252": "CARC 252 requires additional documentation. Submit all requested attachments promptly to avoid further delays.",
};

export const appealStrategyByDenialCategory: Record<
  string,
  {
    category: string;
    keyArguments: string[];
    requiredEvidence: string[];
    regulatoryReferences: string[];
  }
> = {
  medical_necessity: {
    category: "Medical Necessity Denial",
    keyArguments: [
      "The treating provider has determined the service is medically necessary based on the patient's clinical presentation",
      "The service meets the payer's own clinical policy criteria when documentation is fully reviewed",
      "Peer-reviewed medical literature supports the treatment approach for this condition",
      "Alternative treatments have been tried and failed or are contraindicated",
      "Delaying or denying treatment poses significant health risks to the patient",
    ],
    requiredEvidence: [
      "Letter of Medical Necessity from treating provider",
      "Relevant progress notes and clinical documentation",
      "Peer-reviewed literature supporting the treatment",
      "Documentation of prior treatment attempts and outcomes",
      "Applicable clinical practice guidelines",
    ],
    regulatoryReferences: [
      "ERISA Section 503 — full and fair review requirement",
      "ACA Section 2719 — internal and external review processes",
      "State insurance regulations regarding medical necessity determinations",
    ],
  },
  prior_authorization: {
    category: "Prior Authorization / Pre-certification Denial",
    keyArguments: [
      "The service was rendered on an emergency/urgent basis precluding prior authorization",
      "Retroactive authorization is warranted given the clinical circumstances",
      "The provider made a good faith effort to obtain authorization within required timeframes",
      "The payer's authorization requirements were met but not properly recorded",
    ],
    requiredEvidence: [
      "Emergency room records or urgent care documentation",
      "Timeline of authorization attempts",
      "Clinical documentation supporting urgency",
      "Correspondence with payer regarding authorization",
    ],
    regulatoryReferences: [
      "CMS Medicare Managed Care Manual Chapter 13 — expedited review",
      "State prudent layperson emergency standards",
      "ERISA urgent care claim processing requirements",
    ],
  },
  coding: {
    category: "Coding / Billing Error Denial",
    keyArguments: [
      "The original coding accurately reflects the service rendered per medical documentation",
      "The code combination is supported by the clinical record and coding guidelines",
      "Modifier usage follows current CPT/NCCI guidelines for distinct services",
    ],
    requiredEvidence: [
      "Operative/procedure notes",
      "Coding references supporting the code selection",
      "NCCI edits documentation if applicable",
      "Corrected claim form if rebilling",
    ],
    regulatoryReferences: [
      "AMA CPT coding guidelines",
      "CMS NCCI Policy Manual",
      "Payer-specific coding policies",
    ],
  },
  eligibility: {
    category: "Eligibility / Coverage Denial",
    keyArguments: [
      "The patient was actively covered on the date of service",
      "Coordination of benefits has been properly applied",
      "The service is covered under the patient's current benefit plan",
    ],
    requiredEvidence: [
      "Eligibility verification records",
      "Enrollment documentation",
      "Prior payer EOB for coordination of benefits",
      "Benefit plan summary",
    ],
    regulatoryReferences: [
      "HIPAA eligibility transaction standards",
      "State continuation of coverage laws",
      "COBRA coverage provisions if applicable",
    ],
  },
  timely_filing: {
    category: "Timely Filing Denial",
    keyArguments: [
      "The original claim was submitted within the required filing period",
      "Delays were caused by circumstances beyond the provider's control",
      "Proof of timely submission is available",
    ],
    requiredEvidence: [
      "Original submission confirmation/receipt",
      "Clearinghouse transmission reports",
      "Correspondence showing delays from payer side",
      "Documentation of system outages or payer processing errors",
    ],
    regulatoryReferences: [
      "Payer contract timely filing provisions",
      "State prompt payment laws",
      "CMS timely filing guidelines for Medicare",
    ],
  },
  benefit_limit: {
    category: "Benefit Limit / Maximum Reached",
    keyArguments: [
      "The patient's condition requires treatment beyond standard benefit limits",
      "Discontinuation of treatment would result in significant clinical deterioration",
      "An exception to the benefit limit is warranted based on medical necessity",
    ],
    requiredEvidence: [
      "Treatment plan with projected duration",
      "Progress notes showing treatment efficacy",
      "Letter of Medical Necessity for continued treatment",
      "Documentation of clinical deterioration risk",
    ],
    regulatoryReferences: [
      "Mental Health Parity and Addiction Equity Act (if behavioral health)",
      "ACA essential health benefits requirements",
      "State mandated benefit laws",
    ],
  },
  experimental: {
    category: "Experimental / Investigational Denial",
    keyArguments: [
      "The treatment has established clinical efficacy supported by peer-reviewed evidence",
      "The treatment has received FDA approval or clearance for this indication",
      "Major medical societies and clinical guidelines support this treatment approach",
      "Standard treatments have been exhausted or are contraindicated",
    ],
    requiredEvidence: [
      "FDA approval documentation",
      "Peer-reviewed clinical studies and trial results",
      "Professional society position statements",
      "Clinical guidelines recommending the treatment",
      "Documentation of failed standard treatments",
    ],
    regulatoryReferences: [
      "State experimental treatment coverage mandates",
      "ACA clinical trials coverage requirements (Section 2709)",
      "Payer's own technology assessment criteria",
    ],
  },
};
