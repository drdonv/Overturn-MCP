import { DenialCase, RetrievedChunk, ArgumentPlan, PlanResult, UserContext, ServiceItem } from "../types";
import { retrieveForCase } from "../kb/retrieve";
import { KBStore } from "../kb/store";

/** Build argument plan based on denial category and available evidence. */
export function buildArgumentPlan(
  denialCase: DenialCase,
  retrievedChunks: RetrievedChunk[],
  userContext: UserContext = {}
): ArgumentPlan {
  const category = denialCase.denialCategory.value ?? "other";
  const payer = denialCase.payerName.value;
  const services = denialCase.services.value ?? [];
  const cptCodes = services.flatMap((s) => s.cptCodes);
  const policyRefs = (denialCase.policyReferences.value ?? []).map(
    (p) => p.policyId
  );
  const outcome = userContext.requestedOutcome ?? "pay_claim";

  const outcomePhrase =
    {
      pay_claim: "reverse the denial and approve payment",
      approve_service: "approve authorization for the service",
      reprocess: "reprocess the claim correctly",
      reduce_patient_resp: "reduce the patient financial responsibility",
      other: "review and reconsider this claim",
    }[outcome] ?? "reverse the denial";

  // Build thesis
  const thesis = buildThesis(category, payer, services, outcomePhrase, userContext);

  // Build arguments per denial category
  const args = buildArguments(category, denialCase, retrievedChunks, userContext, cptCodes, policyRefs);

  return {
    primaryDenialCategory: category,
    thesis,
    arguments: args,
  };
}

function buildThesis(
  category: string,
  payer: string | null,
  services: ServiceItem[],
  outcomePhrase: string,
  userContext: UserContext
): string {
  const payerStr = payer ? `${payer}'s` : "the payer's";
  const diagStr = userContext.diagnosis ? ` for the treatment of ${userContext.diagnosis}` : "";

  const categoryPhrases: Record<string, string> = {
    benefit_limit:
      `The denial citing benefit limit is improper because the documented clinical need exceeds the plan's standard limitations, and an exception is warranted${diagStr}.`,
    medical_necessity:
      `The denied services are medically necessary${diagStr} as evidenced by clinical documentation demonstrating functional need and the treating provider's professional judgment.`,
    authorization:
      `The denial based on authorization requirements is improper because the services were ${userContext.notes?.includes("emergenc") ? "provided on an emergency basis" : "clinically appropriate and timely"}.`,
    coding:
      `The denial based on coding is incorrect; the submitted CPT codes accurately reflect the services rendered and are supported by the clinical record.`,
    eligibility:
      `The denial based on eligibility is in error; the member was eligible for benefits at the time services were provided.`,
    timely_filing:
      `The denial based on timely filing is improper; the claim was submitted within ${payerStr} required filing window.`,
    other:
      `We respectfully request ${payerStr} claims review department to ${outcomePhrase} based on the evidence presented in this appeal.`,
  };

  return categoryPhrases[category] ?? categoryPhrases["other"];
}

function buildArguments(
  category: string,
  denialCase: DenialCase,
  chunks: RetrievedChunk[],
  userContext: UserContext,
  cptCodes: string[],
  policyRefs: string[]
): ArgumentPlan["arguments"] {
  const hasChunksOfType = (docType: string) =>
    chunks.some((c) => c.meta.docType === docType);

  const args: ArgumentPlan["arguments"] = [];

  // Argument 1: Services were rendered and claim is accurate
  args.push({
    claim: "The services described in the denial letter were provided as billed and are accurately coded.",
    requiredEvidence: [
      "Itemized bill or superbill from provider",
      `CPT code documentation for ${cptCodes.join(", ") || "billed services"}`,
      "Provider's treatment notes for date of service",
    ],
    retrievalQueries: [
      `${cptCodes.join(" ")} documentation requirements`,
      "claim accuracy itemized bill",
    ],
  });

  // Arguments specific to denial category
  if (category === "benefit_limit") {
    args.push({
      claim: "The plan's benefit limit does not preclude coverage when medical necessity warrants an exception or when the session count was miscalculated.",
      requiredEvidence: [
        "Session count record from payer or provider",
        "Plan benefit summary showing applicable limit",
        ...(policyRefs.length > 0
          ? policyRefs.map((p) => `Policy document ${p}`)
          : ["Applicable clinical policy bulletin"]),
        "Provider documentation of remaining functional deficits",
      ],
      retrievalQueries: [
        `${policyRefs.join(" ")} session limit exception medical necessity`,
        `benefit limit appeal physical therapy ${cptCodes.join(" ")}`,
      ],
    });

    args.push({
      claim: "Significant functional improvement has been documented and continuation of therapy is medically necessary.",
      requiredEvidence: [
        "PT progress notes showing functional improvement measurements",
        "Functional outcome measures (e.g., FIM, Oswestry)",
        "Physician attestation of medical necessity",
        ...(userContext.diagnosis ? [`Clinical evidence for ${userContext.diagnosis}`] : []),
      ],
      retrievalQueries: [
        "functional improvement documentation physical therapy",
        "medical necessity exception benefit limit appeal",
      ],
    });
  }

  if (category === "medical_necessity") {
    args.push({
      claim: "The treating provider has determined these services are medically necessary based on clinical evaluation.",
      requiredEvidence: [
        "Physician letter of medical necessity",
        "Clinical notes supporting diagnosis and treatment plan",
        "Evidence-based guidelines supporting treatment",
        ...(userContext.diagnosis ? [`Published clinical criteria for ${userContext.diagnosis}`] : []),
      ],
      retrievalQueries: [
        `medical necessity ${cptCodes.join(" ")} clinical guidelines`,
        `${userContext.diagnosis ?? "physical therapy"} evidence based treatment necessity`,
      ],
    });

    if (hasChunksOfType("clinical")) {
      args.push({
        claim: "Clinical documentation in the record satisfies the payer's medical necessity criteria.",
        requiredEvidence: [
          "Complete clinical notes for all treatment sessions",
          "Standardized outcome measures",
        ],
        retrievalQueries: ["clinical policy bulletin criteria physical therapy"],
      });
    }
  }

  if (category === "authorization") {
    args.push({
      claim: "Prior authorization was either obtained, not required, or excused by clinical circumstances.",
      requiredEvidence: [
        "Authorization number if obtained",
        "Plan evidence showing authorization exemption",
        "Timeline documentation of authorization attempt",
      ],
      retrievalQueries: [
        "prior authorization waiver emergency retroactive approval",
        `authorization exception ${cptCodes.join(" ")}`,
      ],
    });
  }

  if (category === "coding") {
    args.push({
      claim: "The CPT codes billed accurately represent the services rendered and are not subject to bundling edits.",
      requiredEvidence: [
        "AMA CPT code definitions",
        "CMS or payer fee schedule for billed codes",
        "Provider documentation supporting code selection",
      ],
      retrievalQueries: [
        `${cptCodes.join(" ")} unbundling modifier documentation`,
        "coding appeal correct CPT medical record",
      ],
    });
  }

  // Argument: Appeal to payer's internal review policy
  args.push({
    claim: "This appeal is submitted within the payer's stated appeal window and complies with all procedural requirements.",
    requiredEvidence: [
      `Appeal filed within ${denialCase.appealWindowDays.value ?? "[UNKNOWN]"} days of denial date`,
      "Completed appeal request form",
      "Proof of submission (certified mail / fax confirmation / portal receipt)",
    ],
    retrievalQueries: [
      "internal appeal submission requirements timeline",
      `${denialCase.payerName.value ?? "payer"} appeal process requirements`,
    ],
  });

  return args;
}

/** Full plan tool handler. */
export function runPlan(
  store: KBStore,
  denialCase: DenialCase,
  userContext: UserContext = {}
): PlanResult {
  const warnings: string[] = [];
  const missingEvidence: string[] = [];

  // Retrieve relevant KB context
  const retrievedContext = retrieveForCase(store, denialCase);

  // Build argument plan
  const plan = buildArgumentPlan(denialCase, retrievedContext, userContext);

  // Identify missing evidence from DenialCase fields
  if (!denialCase.appealWindowDays.value) {
    missingEvidence.push("Appeal deadline / window days not found in denial letter");
    warnings.push("appealWindowDays not extracted — check denial letter for deadline language");
  }
  if (!denialCase.providerName.value) {
    missingEvidence.push("Provider name not identified — obtain from claim or EOB");
  }
  if (!denialCase.patientResponsibilityAmount.value) {
    missingEvidence.push("Patient responsibility amount not found");
  }
  const hasClinical = retrievedContext.some((c) => c.meta.docType === "clinical");
  if (
    (denialCase.denialCategory.value === "medical_necessity" ||
      denialCase.denialCategory.value === "benefit_limit") &&
    !hasClinical
  ) {
    missingEvidence.push(
      "No clinical notes or PT progress notes found in knowledge base — ingest provider records via kb.ingest"
    );
  }
  if (!denialCase.policyReferences.value?.length) {
    missingEvidence.push(
      "No policy references found — ingest payer's Clinical Policy Bulletin if available"
    );
  }

  return {
    plan,
    retrievedContext,
    missingEvidence,
    warnings,
  };
}
