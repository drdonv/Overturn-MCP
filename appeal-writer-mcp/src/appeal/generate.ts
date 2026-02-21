/**
 * Appeal letter generator.
 *
 * Works in two modes:
 *  1. Template mode (default): fills structured sections from DenialCase + KB evidence.
 *  2. LLM mode (OPENAI_API_KEY set): uses GPT-4o with strict grounding prompt,
 *     then verifies citations.
 *
 * Every factual claim MUST be backed by a Citation (denialCaseSpan or kbChunk).
 * Unsupported claims get [NEEDS EVIDENCE: ...] placeholders.
 */

import { randomUUID } from "crypto";
import {
  DenialCase,
  RetrievedChunk,
  Citation,
  LetterSection,
  AppealLetter,
  GenerateOptions,
  UserContext,
  SourceSpan,
} from "../types";
import { letterId } from "../utils/hash";
import { retrieveForCase } from "../kb/retrieve";
import { buildArgumentPlan } from "./plan";
import { verifySections, collectMissingEvidence } from "./verify";
import { config, log } from "../config";
import { KBStore } from "../kb/store";

// ─── Citation Helpers ──────────────────────────────────────────────────────

function spanToCitation(span: SourceSpan, label: string): Citation {
  return {
    kind: "denialCaseSpan",
    docId: span.docId,
    start: span.start,
    end: span.end,
    snippet: span.snippet,
    label,
  };
}

function chunkToCitation(chunk: RetrievedChunk, label: string): Citation {
  const span = chunk.spans[0] ?? { start: 0, end: chunk.text.length };
  return {
    kind: "kbChunk",
    docId: chunk.docId,
    start: span.start,
    end: span.end,
    snippet: chunk.text.slice(0, 120).replace(/\n/g, " "),
    label,
  };
}

/** Inline citation tag for fullText. */
function inlineTag(citation: Citation): string {
  return `[CITE:${citation.kind}:${citation.docId}:${citation.start}-${citation.end}]`;
}

function val<T>(field: { value: T | null; spans: SourceSpan[] }): T | null {
  return field.value;
}

function spans(field: { spans: SourceSpan[] }): SourceSpan[] {
  return field.spans;
}

// ─── Section Builders ──────────────────────────────────────────────────────

function buildHeaderSection(
  dc: DenialCase,
  userContext: UserContext,
  opts: GenerateOptions
): LetterSection {
  const today = new Date().toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric",
  });
  const letterDate = val(dc.letterDate) ?? today;
  const memberName = val(dc.memberName) ?? "[Member Name]";
  const memberId = val(dc.memberId) ?? "[Member ID]";
  const claimNumber = val(dc.claimNumber) ?? "[Claim Number]";
  const payer = val(dc.payerName) ?? "[Payer Name]";
  const payerAddr = val(dc.payerAddress) ?? "[Payer Address]";

  const citations: Citation[] = [
    ...spans(dc.memberName).map((s) => spanToCitation(s, "memberName")),
    ...spans(dc.memberId).map((s) => spanToCitation(s, "memberId")),
    ...spans(dc.claimNumber).map((s) => spanToCitation(s, "claimNumber")),
    ...spans(dc.payerName).map((s) => spanToCitation(s, "payerName")),
    ...spans(dc.letterDate).map((s) => spanToCitation(s, "letterDate")),
  ];

  const patientBlock = userContext.patientAddress
    ? `${memberName}\n${userContext.patientAddress}\n${userContext.patientPhone ?? ""}\n\n`
    : `${memberName}\n\n`;

  const content = `${today}

${patientBlock}${payer}
${payerAddr}

Re: INTERNAL APPEAL — Denial of Claim
Member Name: ${memberName}
Member ID: ${memberId}
Claim Number: ${claimNumber}
Date of Original Denial Letter: ${letterDate}`;

  return { id: "header", title: "Header", content, citations };
}

function buildServiceDetailsSection(
  dc: DenialCase,
  opts: GenerateOptions
): LetterSection {
  const services = val(dc.services) ?? [];
  const serviceDate = val(dc.serviceDate) ?? "[Date of Service]";
  const provider = val(dc.providerName) ?? "[Provider Name]";
  const citations: Citation[] = [
    ...spans(dc.services).map((s) => spanToCitation(s, "services")),
    ...spans(dc.serviceDate).map((s) => spanToCitation(s, "serviceDate")),
    ...spans(dc.providerName).map((s) => spanToCitation(s, "providerName")),
  ];

  const serviceLines = services.map((svc) => {
    const cpts = svc.cptCodes.length > 0 ? ` (CPT: ${svc.cptCodes.join(", ")})` : "";
    const amount =
      svc.amountRequested !== null
        ? ` — Billed Amount: ${svc.currency} ${svc.amountRequested.toFixed(2)}`
        : "";
    return `  • ${svc.serviceName}${cpts}${amount} — Status: ${svc.status}`;
  }).join("\n");

  const providerNote = val(dc.providerName)
    ? `provided by ${provider}`
    : "[NEEDS EVIDENCE: provider name not found — obtain from claim or EOB]";

  const content = `Dear Claims Review Department,

We are writing to formally appeal the denial of the following service(s) ${providerNote} on ${serviceDate}:

${serviceLines || "  • [NEEDS EVIDENCE: service details not extracted from denial letter]"}

Please review the complete record and clinical justification presented below.`;

  return { id: "service_details", title: "Service and Claim Details", content, citations };
}

function buildRequestSection(dc: DenialCase, userContext: UserContext): LetterSection {
  const claimNumber = val(dc.claimNumber) ?? "[Claim Number]";
  const outcome = userContext.requestedOutcome ?? "pay_claim";
  const outcomeText =
    {
      pay_claim: "reverse this denial and approve payment for the services rendered",
      approve_service: "approve authorization for the requested service",
      reprocess: "reprocess this claim and issue correct payment",
      reduce_patient_resp: "reduce the patient financial responsibility to the correct contracted rate",
      other: "reconsider this claim in light of the evidence provided",
    }[outcome] ?? "reverse this denial";

  const citations: Citation[] = [
    ...spans(dc.claimNumber).map((s) => spanToCitation(s, "claimNumber")),
  ];

  const content = `We respectfully request that you ${outcomeText} for claim number ${claimNumber}. We have enclosed all supporting clinical documentation and evidence demonstrating that this service is covered and medically warranted.`;

  return { id: "request", title: "Request for Review", content, citations };
}

function buildDenialSummarySection(
  dc: DenialCase,
  chunks: RetrievedChunk[]
): LetterSection {
  const denialReason = val(dc.denialReasonSummary) ?? "[Denial reason not extracted]";
  const letterDate = val(dc.letterDate) ?? "[date]";
  const policyRefs = val(dc.policyReferences) ?? [];
  const citations: Citation[] = [
    ...spans(dc.denialReasonSummary).map((s) => spanToCitation(s, "denialReason")),
    ...spans(dc.policyReferences).map((s) => spanToCitation(s, "policyReferences")),
    ...spans(dc.letterDate).map((s) => spanToCitation(s, "letterDate")),
  ];

  const policyStr =
    policyRefs.length > 0
      ? ` citing ${policyRefs.map((p) => p.policyId + (p.title ? ` (${p.title})` : "")).join(", ")}`
      : "";

  const content = `In your letter dated ${letterDate}, you denied coverage for the above service(s)${policyStr}, stating:

"${denialReason}"

We respectfully contest this determination on the grounds set forth below.`;

  return {
    id: "denial_summary",
    title: "Summary of Denial Reason",
    content,
    citations,
  };
}

function buildRebuttalSection(
  dc: DenialCase,
  chunks: RetrievedChunk[],
  userContext: UserContext
): LetterSection {
  const category = val(dc.denialCategory) ?? "other";
  const citations: Citation[] = [];
  const warnings: string[] = [];

  // Pull KB citations for this section
  const relevantChunks = chunks
    .filter((c) =>
      c.meta.docType === "policy" ||
      c.meta.docType === "prior_appeal_accepted" ||
      c.meta.docType === "clinical" ||
      c.meta.docType === "template"
    )
    .slice(0, 4);

  for (const chunk of relevantChunks) {
    citations.push(chunkToCitation(chunk, `kb:${chunk.meta.docType}`));
  }

  const policyRefs = val(dc.policyReferences) ?? [];
  const policyStr =
    policyRefs.length > 0
      ? policyRefs.map((p) => p.policyId).join(", ")
      : null;

  let content = "";

  if (category === "benefit_limit") {
    const hasClinical = chunks.some((c) => c.meta.docType === "clinical");
    const hasPolicyChunk = chunks.some((c) => c.meta.docType === "policy");

    content = `REBUTTAL — Benefit Limit Exception

${policyStr ? `Your denial references ${policyStr}, which limits coverage under standard circumstances.` : "[NEEDS EVIDENCE: cite the specific policy provision that applies]"}${hasPolicyChunk ? "" : " [NEEDS EVIDENCE: obtain and attach the referenced Clinical Policy Bulletin to verify the stated session limit]"}

We assert that this patient's circumstances warrant an exception for the following reasons:

1. Documented Medical Necessity: The treating provider has determined that continued services are medically necessary. ${hasClinical ? "Clinical documentation enclosed herewith demonstrates ongoing functional deficits requiring continued skilled intervention." : "[NEEDS EVIDENCE: PT progress notes documenting current functional status and deficits]"}

2. Functional Improvement: ${hasClinical ? "Enclosed clinical records demonstrate measurable functional improvement, evidencing that therapy is producing the expected results and should continue." : "[NEEDS EVIDENCE: PT progress notes showing functional improvement measurements (e.g., outcome scores, range of motion, pain scale)]."}

3. Session Count Verification: We request verification of the session count used in this determination. If any sessions were miscounted or improperly attributed, the limit has not been reached. [NEEDS EVIDENCE: payer's session count record for this member and benefit year]

Accordingly, we request that the payer invoke its medical necessity exception process and approve additional sessions as documented by the treating provider.`;
  } else if (category === "medical_necessity") {
    const hasClinical = chunks.some((c) => c.meta.docType === "clinical");
    const diagStr = userContext.diagnosis ? ` for ${userContext.diagnosis}` : "";

    content = `REBUTTAL — Medical Necessity

The denied services are medically necessary${diagStr} and meet the criteria for coverage under the member's plan. The treating provider has documented clinical findings that support this determination.

${hasClinical ? "Enclosed clinical notes and provider documentation demonstrate:\n  • Diagnosis and functional deficits requiring skilled intervention\n  • Treatment plan aligned with evidence-based clinical guidelines\n  • Progress toward measurable functional goals" : "[NEEDS EVIDENCE: clinical notes documenting diagnosis, functional deficits, treatment plan, and measurable goals]"}

${policyStr ? `The plan's criteria under ${policyStr}` : "The applicable clinical policy criteria"} are satisfied as shown in the enclosed documentation. We request immediate reversal of this denial based on the attached evidence.`;
  } else if (category === "authorization") {
    content = `REBUTTAL — Authorization

${val(dc.denialReasonSummary)?.toLowerCase().includes("emergenc")
  ? "The services were provided on an emergency basis, which is exempt from prior authorization requirements under applicable regulations."
  : "We contest the denial based on authorization for the following reasons:"}

[NEEDS EVIDENCE: one of the following — (a) authorization number if obtained, (b) documentation that authorization was not required for this service/setting, or (c) timeline showing timely authorization attempt and any payer delay]

We request that you review the authorization status and reprocess this claim accordingly.`;
  } else if (category === "coding") {
    const services = val(dc.services) ?? [];
    const cptStr = services.flatMap((s) => s.cptCodes).join(", ");

    content = `REBUTTAL — Coding and Billing

The services billed under CPT code(s) ${cptStr || "[NEEDS EVIDENCE: CPT codes]"} accurately represent the services rendered and are properly documented in the clinical record.

[NEEDS EVIDENCE: AMA CPT code definition printout for billed codes, and provider documentation supporting code selection]

We request that you reprocess this claim using the correct adjudication criteria.`;
  } else if (category === "eligibility") {
    content = `REBUTTAL — Member Eligibility

The member was eligible for benefits under this plan at the time services were rendered. [NEEDS EVIDENCE: eligibility verification record showing active coverage on date of service]

We request that you verify eligibility using the correct member ID and date of service and reprocess accordingly.`;
  } else if (category === "timely_filing") {
    content = `REBUTTAL — Timely Filing

The claim was submitted within the plan's required filing window. [NEEDS EVIDENCE: original claim submission confirmation, date stamp, or clearinghouse records demonstrating timely filing]

We request that you verify the original submission date and reprocess this claim.`;
  } else {
    content = `REBUTTAL

Based on a thorough review of the applicable coverage provisions and clinical record, we believe the denial of this claim is improper. ${chunks.length > 0 ? "We have identified supporting documentation in the knowledge base that is attached hereto." : "[NEEDS EVIDENCE: supporting documentation to rebut the stated denial reason]"}

We respectfully request that you conduct a full clinical review of the enclosed evidence and reverse this determination.`;
  }

  if (citations.length === 0) {
    warnings.push(
      "Rebuttal section has no KB citations — ingest relevant policy and clinical documents via kb.ingest to strengthen this argument."
    );
  }

  return {
    id: "rebuttal",
    title: "Rebuttal and Supporting Arguments",
    content,
    citations,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

function buildAttachmentsSection(
  dc: DenialCase,
  chunks: RetrievedChunk[]
): LetterSection {
  const required = val(dc.requiredAttachments) ?? [];
  const hasClinical = chunks.some((c) => c.meta.docType === "clinical");
  const category = val(dc.denialCategory) ?? "other";

  const baseAttachments = [
    ...required,
    ...(hasClinical ? ["Clinical notes (enclosed from provider records)"] : []),
    ...(category === "benefit_limit" || category === "medical_necessity"
      ? ["Physician / provider letter of medical necessity", "Functional outcome measures"]
      : []),
    "Completed Appeal Request Form",
    "Copy of original denial letter",
    "Proof of appeal submission",
  ];

  // Deduplicate
  const unique = [...new Set(baseAttachments)];

  const citations: Citation[] = [
    ...spans(dc.requiredAttachments).map((s) => spanToCitation(s, "requiredAttachments")),
    ...chunks
      .filter((c) => c.meta.docType === "clinical")
      .slice(0, 2)
      .map((c) => chunkToCitation(c, "clinical_evidence")),
  ];

  const content = `The following documents are enclosed in support of this appeal:\n\n${unique.map((a, i) => `${i + 1}. ${a}`).join("\n")}`;

  return {
    id: "attachments",
    title: "Enclosed Documentation",
    content,
    citations,
  };
}

function buildClosingSection(
  dc: DenialCase,
  userContext: UserContext
): LetterSection {
  const memberName = val(dc.memberName) ?? "[Member Name]";
  const appealWindow = val(dc.appealWindowDays);
  const methods = val(dc.appealSubmissionMethods) ?? [];
  const methodStr = methods.length > 0 ? methods.join(" or ") : "the address on file";
  const contact = userContext.patientPhone
    ? `\n\nIf you have any questions, please contact us at ${userContext.patientPhone}.`
    : "";

  const urgencyNote = appealWindow
    ? `This appeal is time-sensitive; please process within your standard internal appeal timeline.`
    : "[NEEDS EVIDENCE: confirm appeal deadline from denial letter or plan documents]";

  const citations: Citation[] = [
    ...spans(dc.memberName).map((s) => spanToCitation(s, "memberName")),
    ...spans(dc.appealWindowDays).map((s) => spanToCitation(s, "appealWindowDays")),
    ...spans(dc.appealSubmissionMethods).map((s) => spanToCitation(s, "submissionMethods")),
  ];

  const content = `${urgencyNote}

We trust you will give this appeal full and fair consideration. We are available to provide any additional documentation you require.${contact}

Sincerely,

${memberName}
Member / Patient Representative

Submission method: ${methodStr}`;

  return { id: "closing", title: "Closing and Signature", content, citations };
}

// ─── LLM-Enhanced Generation ──────────────────────────────────────────────

async function generateWithLLM(
  dc: DenialCase,
  chunks: RetrievedChunk[],
  userContext: UserContext,
  opts: GenerateOptions
): Promise<LetterSection[] | null> {
  if (!config.openaiApiKey) return null;

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const OpenAI = require("openai") as {
      default: new (opts: { apiKey: string }) => {
        chat: {
          completions: {
            create: (opts: {
              model: string;
              response_format: { type: string };
              messages: Array<{ role: string; content: string }>;
              temperature: number;
            }) => Promise<{
              choices: Array<{ message: { content: string | null } }>;
            }>;
          };
        };
      };
    };

    const client = new OpenAI.default({ apiKey: config.openaiApiKey });

    const caseContext = formatDenialCaseForPrompt(dc);
    const kbContext = chunks
      .slice(0, 10)
      .map(
        (c, i) =>
          `[KB_CHUNK_${i}] DocType: ${c.meta.docType} | ChunkId: ${c.chunkId}\n${c.text}`
      )
      .join("\n\n---\n\n");

    const systemPrompt = `You are a medical claims appeal specialist generating a formal appeal letter.

STRICT RULES — NEVER VIOLATE:
1. Use ONLY facts, numbers, dates, and policies from the DENIAL CASE and KB CHUNKS provided below.
2. Do NOT invent payer addresses, fax numbers, policy names, session counts, dollar amounts, or medical facts.
3. For any claim you cannot support with the provided evidence, write exactly: [NEEDS EVIDENCE: brief description]
4. Every paragraph containing a dollar amount, date, session count, or CPT code MUST cite its source.
5. Tone: ${opts.tone ?? "professional"}

OUTPUT FORMAT — return valid JSON:
{
  "sections": [
    {
      "id": "section_id",
      "title": "Section Title",
      "content": "Section content text with [NEEDS EVIDENCE:...] where unsupported",
      "citationIds": ["KB_CHUNK_0", "KB_CHUNK_2", "DENIAL_CASE_SPAN:memberName"]
    }
  ]
}

Sections to generate (all of them):
1. header (id: "header")
2. service_details (id: "service_details")
3. request (id: "request")
4. denial_summary (id: "denial_summary")
5. rebuttal (id: "rebuttal")
6. attachments (id: "attachments")
7. closing (id: "closing")`;

    const userMsg = `DENIAL CASE:
${caseContext}

RETRIEVED KNOWLEDGE BASE:
${kbContext || "(no KB documents ingested — use NEEDS EVIDENCE placeholders)"}

USER CONTEXT:
${JSON.stringify(userContext, null, 2)}`;

    const response = await client.chat.completions.create({
      model: config.openaiModel,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMsg },
      ],
      temperature: 0.1, // low temperature for consistency
    });

    const raw = response.choices[0]?.message?.content;
    if (!raw) return null;

    const parsed = JSON.parse(raw) as {
      sections: Array<{
        id: string;
        title: string;
        content: string;
        citationIds: string[];
      }>;
    };

    // Convert citationIds to Citation objects
    return parsed.sections.map((s) => {
      const citations: Citation[] = [];
      for (const cid of s.citationIds ?? []) {
        if (cid.startsWith("KB_CHUNK_")) {
          const idx = parseInt(cid.replace("KB_CHUNK_", ""), 10);
          const chunk = chunks[idx];
          if (chunk) citations.push(chunkToCitation(chunk, `llm:${chunk.meta.docType}`));
        } else if (cid.startsWith("DENIAL_CASE_SPAN:")) {
          const label = cid.replace("DENIAL_CASE_SPAN:", "");
          // Find matching spans from denial case
          const fieldMap: Record<string, SourceSpan[]> = {
            memberName: dc.memberName.spans,
            memberId: dc.memberId.spans,
            claimNumber: dc.claimNumber.spans,
            payerName: dc.payerName.spans,
            letterDate: dc.letterDate.spans,
            denialReason: dc.denialReasonSummary.spans,
            serviceDate: dc.serviceDate.spans,
            services: dc.services.spans,
            policyReferences: dc.policyReferences.spans,
            appealWindowDays: dc.appealWindowDays.spans,
          };
          const matchingSpans = fieldMap[label] ?? [];
          citations.push(
            ...matchingSpans.map((span) => spanToCitation(span, label))
          );
        }
      }
      return {
        id: s.id,
        title: s.title,
        content: s.content,
        citations,
      } as LetterSection;
    });
  } catch (err) {
    log("warn", "LLM generation failed — falling back to template", err);
    return null;
  }
}

function formatDenialCaseForPrompt(dc: DenialCase): string {
  const f = <T>(label: string, field: { value: T | null }): string =>
    `${label}: ${field.value !== null ? JSON.stringify(field.value) : "(not found)"}`;

  return [
    f("Payer Name", dc.payerName),
    f("Payer Address", dc.payerAddress),
    f("Letter Date", dc.letterDate),
    f("Member Name", dc.memberName),
    f("Member ID", dc.memberId),
    f("Claim Number", dc.claimNumber),
    f("Provider Name", dc.providerName),
    f("Service Date", dc.serviceDate),
    f("Services", dc.services),
    f("Denial Category", dc.denialCategory),
    f("Denial Reason", dc.denialReasonSummary),
    f("Policy References", dc.policyReferences),
    f("Patient Responsibility", dc.patientResponsibilityAmount),
    f("Appeal Window Days", dc.appealWindowDays),
    f("Appeal Submission Methods", dc.appealSubmissionMethods),
    f("Appeal Instructions", dc.appealInstructions),
    f("Required Attachments", dc.requiredAttachments),
  ].join("\n");
}

// ─── Action Items ──────────────────────────────────────────────────────────

function buildActionItems(
  dc: DenialCase,
  missingEvidence: string[],
  chunks: RetrievedChunk[]
): AppealLetter["actionItems"] {
  const category = val(dc.denialCategory) ?? "other";
  const appealDays = val(dc.appealWindowDays);
  const methods = val(dc.appealSubmissionMethods) ?? [];
  const citations: Citation[] = spans(dc.appealWindowDays).map((s) =>
    spanToCitation(s, "appealWindowDays")
  );

  const items: AppealLetter["actionItems"] = [];

  // P0: Confirm deadline
  items.push({
    priority: "p0",
    action: appealDays
      ? `Confirm and calendar the appeal deadline: ${appealDays} days from the denial letter date. File before this date to preserve your rights.`
      : "Confirm the appeal deadline from the denial letter. [NEEDS EVIDENCE: appeal window not extracted]",
    why: "Missing the appeal deadline permanently waives your right to an internal appeal.",
    citations,
  });

  // P0: Gather clinical evidence (for medical necessity or benefit limit)
  if (category === "benefit_limit" || category === "medical_necessity") {
    const hasClinical = chunks.some((c) => c.meta.docType === "clinical");
    items.push({
      priority: "p0",
      action: hasClinical
        ? "Obtain complete PT/clinical progress notes for all treatment sessions and include them in the appeal packet."
        : "Contact provider to obtain: (1) progress notes for all sessions, (2) functional outcome measures, (3) physician letter of medical necessity. These are your strongest evidence.",
      why:
        category === "benefit_limit"
          ? "Benefit limit exceptions require documented functional improvement and clinical necessity."
          : "Medical necessity denials are overturned most reliably with complete clinical documentation.",
      citations: chunks
        .filter((c) => c.meta.docType === "clinical")
        .slice(0, 1)
        .map((c) => chunkToCitation(c, "clinical")),
    });
  }

  // P1: Physician letter
  items.push({
    priority: "p1",
    action:
      "Request a physician letter of medical necessity addressing the specific denial reason, functional deficits, and why additional services are warranted.",
    why: "A physician's direct attestation carries significant weight in the clinical review process.",
    citations: spans(dc.denialReasonSummary).map((s) =>
      spanToCitation(s, "denialReason")
    ),
  });

  // P1: Policy-specific evidence
  const policyRefs = val(dc.policyReferences) ?? [];
  if (policyRefs.length > 0) {
    const hasPolicyChunk = chunks.some((c) => c.meta.docType === "policy");
    items.push({
      priority: "p1",
      action: hasPolicyChunk
        ? `Review retrieved policy excerpts for ${policyRefs.map((p) => p.policyId).join(", ")} and ensure your clinical documentation satisfies every listed criterion.`
        : `Obtain ${policyRefs.map((p) => p.policyId).join(", ")} from the payer website and ingest via kb.ingest to strengthen evidence matching.`,
      why: "Rebutting a policy-specific denial requires demonstrating compliance with that exact policy's criteria.",
      citations: spans(dc.policyReferences).map((s) =>
        spanToCitation(s, "policyReferences")
      ),
    });
  }

  // P2: Submission confirmation
  items.push({
    priority: "p2",
    action:
      methods.length > 0
        ? `Submit appeal via ${methods.join(" or ")} and obtain proof of submission (certified mail receipt, fax confirmation, or portal upload confirmation).`
        : "Confirm where to submit the appeal (mail, fax, or portal) from the denial letter or payer website, then submit and retain proof.",
    why: "Proof of timely submission protects you if the payer claims non-receipt.",
    citations: spans(dc.appealSubmissionMethods).map((s) =>
      spanToCitation(s, "submissionMethods")
    ),
  });

  // P2: Missing evidence items from verification
  if (missingEvidence.length > 0) {
    items.push({
      priority: "p2",
      action: `Resolve missing evidence items before submission: ${missingEvidence.slice(0, 3).join("; ")}${missingEvidence.length > 3 ? ` (and ${missingEvidence.length - 3} more)` : ""}.`,
      why: "NEEDS EVIDENCE placeholders in the letter indicate gaps that weaken the appeal.",
      citations: [],
    });
  }

  return items;
}

// ─── Attachment Checklist ──────────────────────────────────────────────────

function buildAttachmentChecklist(
  dc: DenialCase,
  chunks: RetrievedChunk[]
): AppealLetter["attachmentChecklist"] {
  const required = val(dc.requiredAttachments) ?? [];
  const category = val(dc.denialCategory) ?? "other";
  const hasClinical = chunks.some((c) => c.meta.docType === "clinical");

  const items: Array<{ item: string; required: boolean; source?: string }> = [
    { item: "Completed Appeal Request Form", required: true },
    { item: "Copy of original denial letter", required: true },
    { item: "Physician / provider letter of medical necessity", required: true },
    ...required.map((r) => ({ item: r, required: true })),
    ...(category === "benefit_limit" || category === "medical_necessity"
      ? [
          { item: "PT/clinical progress notes for all sessions", required: true },
          { item: "Functional outcome measurement scores", required: true },
          { item: "Treatment plan (initial and current)", required: false },
        ]
      : []),
    ...(hasClinical
      ? [{ item: "Enclosed clinical notes (from KB)", required: false }]
      : []),
    { item: "Proof of submission (certified mail receipt / fax confirmation)", required: false },
  ];

  // Deduplicate by item text
  const seen = new Set<string>();
  const deduped = items.filter((i) => {
    if (seen.has(i.item)) return false;
    seen.add(i.item);
    return true;
  });

  const reqSpanCitations = spans(dc.requiredAttachments).map((s) =>
    spanToCitation(s, "requiredAttachments")
  );

  return deduped.map((i) => ({
    item: i.item,
    required: i.required,
    citations: i.required ? reqSpanCitations.slice(0, 1) : [],
  }));
}

// ─── Full Text Assembly ────────────────────────────────────────────────────

function assembleFullText(
  sections: LetterSection[],
  includeCitationsInline: boolean
): string {
  return sections
    .map((s) => {
      let text = s.content;
      if (includeCitationsInline && s.citations.length > 0) {
        const tags = s.citations.map(inlineTag).join(" ");
        text = `${text}\n${tags}`;
      }
      return text;
    })
    .join("\n\n" + "─".repeat(40) + "\n\n");
}

// ─── Main Generate Function ────────────────────────────────────────────────

export async function generateAppealLetter(
  store: KBStore,
  denialCase: DenialCase,
  options: GenerateOptions = {},
  userContext: UserContext = {}
): Promise<AppealLetter> {
  const tone = options.tone ?? "professional";
  const includeCitationsInline = options.includeCitationsInline ?? true;
  const createdAt = new Date().toISOString();

  // 1. Retrieve KB context for this case
  const chunks = retrieveForCase(store, denialCase);
  log("debug", "Retrieved KB chunks", { count: chunks.length });

  // 2. Try LLM generation; fall back to template
  let sections: LetterSection[];
  const llmSections = await generateWithLLM(denialCase, chunks, userContext, options);

  if (llmSections && llmSections.length >= 5) {
    log("info", "Using LLM-generated sections");
    sections = llmSections;
  } else {
    log("info", "Using template-generated sections");
    sections = [
      buildHeaderSection(denialCase, userContext, options),
      buildServiceDetailsSection(denialCase, options),
      buildRequestSection(denialCase, userContext),
      buildDenialSummarySection(denialCase, chunks),
      buildRebuttalSection(denialCase, chunks, userContext),
      buildAttachmentsSection(denialCase, chunks),
      buildClosingSection(denialCase, userContext),
    ];
  }

  // 3. Verify citations — patch missing ones with NEEDS EVIDENCE
  const { sections: verifiedSections, unresolvedClaims, warnings: verifyWarnings } =
    verifySections(sections);

  // 4. Collect all missing evidence
  const missingEvidence = collectMissingEvidence(verifiedSections);

  // 5. Build action items
  const actionItems = buildActionItems(denialCase, missingEvidence, chunks);

  // 6. Build attachment checklist
  const attachmentChecklist = buildAttachmentChecklist(denialCase, chunks);

  // 7. Assemble full text
  const fullText = assembleFullText(verifiedSections, includeCitationsInline);

  return {
    letterId: letterId(denialCase.caseId, createdAt),
    caseId: denialCase.caseId,
    payerName: denialCase.payerName.value,
    createdAt,
    tone,
    sections: verifiedSections,
    fullText,
    attachmentChecklist,
    missingEvidence,
    actionItems,
  };
}
