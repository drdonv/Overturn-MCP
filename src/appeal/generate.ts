/**
 * Appeal letter generator.
 *
 * Works in two modes:
 *  1. Template mode (default): fills structured sections from DenialCase + KB evidence.
 *  2. LLM mode (ANTHROPIC_API_KEY set): uses Claude with strict grounding prompt + RAG,
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
  ParsedCaseFields,
  Identifier,
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

function inlineTag(citation: Citation): string {
  return `[CITE:${citation.kind}:${citation.docId}:${citation.start}-${citation.end}]`;
}

function val<T>(field: { value: T | null; spans: SourceSpan[] }): T | null {
  return field.value;
}

function spans(field: { spans: SourceSpan[] }): SourceSpan[] {
  return field.spans;
}

// ─── Resolve helper: pull values from DenialCase with fallbacks ─────────

function resolveFields(dc: DenialCase, userContext: UserContext) {
  const patientName = dc.patient_name ?? val(dc.memberName) ?? "[Patient Name]";
  const patientAddress = dc.patient_address ?? userContext.patientAddress ?? "[Patient Address]";
  const claimId = dc.claim_id ?? val(dc.claimNumber) ?? "[Claim ID]";
  const memberId = val(dc.memberId) ?? "[Member ID]";
  const payerName = userContext.insuranceCompanyName ?? val(dc.payerName) ?? "[Insurance Company Name]";
  const payerAddress = userContext.insuranceCompanyAddress ?? val(dc.payerAddress) ?? "[Insurance Company Address]";
  const denialReasonText = dc.denial_reason_text ?? val(dc.denialReasonSummary) ?? "[Denial reason not extracted]";
  const denialCodes = dc.denial_codes ?? [];
  const denialCodeAnalysis = dc.denial_code_analysis ?? {};
  const identifiers: Identifier[] = dc.identifiers ?? (
    val(dc.memberId) ? [{ label: "Member ID", value: val(dc.memberId)! }] : []
  );
  const letterDate = val(dc.letterDate) ?? "[Date of Denial]";
  const phone = userContext.patientPhone ?? "[Phone Number]";
  const email = userContext.patientEmail ?? "[Email Address]";
  const extractionNotes = dc.extraction_notes ?? null;

  return {
    patientName, patientAddress, claimId, memberId, payerName, payerAddress,
    denialReasonText, denialCodes, denialCodeAnalysis, identifiers, letterDate,
    phone, email, extractionNotes,
  };
}

// ─── Section Builders (following user's appeal letter template) ─────────

function buildHeaderSection(
  dc: DenialCase,
  userContext: UserContext,
  _opts: GenerateOptions
): LetterSection {
  const f = resolveFields(dc, userContext);
  const today = new Date().toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric",
  });

  const citations: Citation[] = [
    ...spans(dc.memberName).map((s) => spanToCitation(s, "memberName")),
    ...spans(dc.memberId).map((s) => spanToCitation(s, "memberId")),
    ...spans(dc.claimNumber).map((s) => spanToCitation(s, "claimNumber")),
    ...spans(dc.payerName).map((s) => spanToCitation(s, "payerName")),
    ...spans(dc.letterDate).map((s) => spanToCitation(s, "letterDate")),
  ];

  const identifierLines = f.identifiers
    .map((id) => `- ${id.label}: ${id.value}`)
    .join("\n");

  const content = `${today}

${f.payerName}
Appeals and Grievances Department
${f.payerAddress}

RE: Appeal of Denied Claim
Patient Name: ${f.patientName}
Patient Address: ${f.patientAddress}
Claim ID: ${f.claimId}

Identifiers:
${identifierLines || "- Member ID: " + f.memberId}`;

  return { id: "header", title: "Header", content, citations };
}

function buildOpeningSection(
  dc: DenialCase,
  userContext: UserContext
): LetterSection {
  const f = resolveFields(dc, userContext);
  const citations: Citation[] = [
    ...spans(dc.claimNumber).map((s) => spanToCitation(s, "claimNumber")),
    ...spans(dc.denialReasonSummary).map((s) => spanToCitation(s, "denialReason")),
  ];

  const content = `To Whom It May Concern:

I am writing to formally appeal the denial of coverage for the above-referenced claim.

According to the Explanation of Benefits, this claim (Claim ID: ${f.claimId}) was denied for the following reason(s):`;

  return { id: "opening", title: "Opening Statement", content, citations };
}

function buildDenialCodesSection(
  dc: DenialCase,
  chunks: RetrievedChunk[]
): LetterSection {
  const denialCodes = dc.denial_codes ?? [];
  const denialReasonText = dc.denial_reason_text ?? val(dc.denialReasonSummary) ?? "[Denial reason not extracted]";
  const denialCodeAnalysis = dc.denial_code_analysis ?? {};

  const citations: Citation[] = [
    ...spans(dc.denialReasonSummary).map((s) => spanToCitation(s, "denialReason")),
  ];

  // Add KB citations for denial code context
  const codeChunks = chunks
    .filter((c) => c.meta.docType === "policy" || c.meta.docType === "benefits")
    .slice(0, 3);
  for (const chunk of codeChunks) {
    citations.push(chunkToCitation(chunk, `kb:${chunk.meta.docType}`));
  }

  const codeLines = denialCodes.length > 0
    ? denialCodes.map((code) => `- ${code}`).join("\n")
    : "- [No denial codes extracted]";

  const analysisLines = Object.keys(denialCodeAnalysis).length > 0
    ? Object.entries(denialCodeAnalysis).map(([code, explanation]) => `- ${code}: ${explanation}`).join("\n")
    : denialCodes.length > 0
      ? denialCodes.map((code) => `- ${code}: [NEEDS EVIDENCE: human-readable interpretation for this code]`).join("\n")
      : "- [No denial code analysis available]";

  const content = `Denial Codes:
${codeLines}

Denial Reason as Stated:
"${denialReasonText}"

Denial Code Analysis (Human-Readable Interpretation):
${analysisLines}`;

  return { id: "denial_codes", title: "Denial Codes and Reason", content, citations };
}

function buildClinicalContextSection(
  dc: DenialCase,
  chunks: RetrievedChunk[],
  userContext: UserContext
): LetterSection {
  const f = resolveFields(dc, userContext);
  const citations: Citation[] = [];
  const warnings: string[] = [];

  const clinicalChunks = chunks
    .filter((c) => c.meta.docType === "clinical" || c.meta.docType === "prior_appeal_accepted")
    .slice(0, 4);
  for (const chunk of clinicalChunks) {
    citations.push(chunkToCitation(chunk, `kb:${chunk.meta.docType}`));
  }

  const hasClinical = clinicalChunks.length > 0;
  if (!hasClinical) {
    warnings.push("No clinical documentation found in KB — ingest provider records via kb.ingest to strengthen this section.");
  }

  const diagStr = userContext.diagnosis
    ? `the condition (${userContext.diagnosis}) related to this claim`
    : "the condition related to this claim";

  const content = `Based on the documentation provided and the clinical circumstances surrounding this claim, the denial appears to be inconsistent with the applicable coverage criteria and medical necessity standards.

Clinical Context:
The patient, ${f.patientName}, has been under active medical care for ${diagStr}. The treating provider has determined that the service rendered was medically necessary and appropriate given the patient's diagnosis, symptoms, and treatment history. ${hasClinical ? "Supporting documentation, including the Letter of Medical Necessity and relevant medical records, has been included for your review." : "[NEEDS EVIDENCE: Letter of Medical Necessity and relevant medical records should be included for review]"}`;

  return {
    id: "clinical_context",
    title: "Clinical Context",
    content,
    citations,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

function buildGroundsForAppealSection(
  dc: DenialCase,
  chunks: RetrievedChunk[],
  userContext: UserContext
): LetterSection {
  const citations: Citation[] = [];
  const category = val(dc.denialCategory) ?? "other";
  const denialCodes = dc.denial_codes ?? [];
  const denialCodeAnalysis = dc.denial_code_analysis ?? {};

  const policyChunks = chunks
    .filter((c) => c.meta.docType === "policy" || c.meta.docType === "template" || c.meta.docType === "prior_appeal_accepted")
    .slice(0, 4);
  for (const chunk of policyChunks) {
    citations.push(chunkToCitation(chunk, `kb:${chunk.meta.docType}`));
  }

  let categorySpecificGrounds = "";
  if (category === "benefit_limit") {
    categorySpecificGrounds = `4. The patient's documented clinical progress and ongoing functional deficits warrant an exception to the standard benefit limit.
5. Published clinical guidelines support continued treatment beyond the stated limit when measurable improvement is documented.`;
  } else if (category === "medical_necessity") {
    categorySpecificGrounds = `4. The treating provider's clinical judgment, supported by the enclosed documentation, confirms that the service meets established medical necessity criteria.
5. Evidence-based clinical guidelines support the medical necessity of the rendered services for the patient's diagnosed condition.`;
  } else if (category === "authorization") {
    categorySpecificGrounds = `4. Authorization was obtained, not required for the service in question, or clinical circumstances warranted immediate treatment without delay.`;
  } else if (category === "coding") {
    categorySpecificGrounds = `4. The CPT codes submitted accurately represent the services rendered and are properly supported by clinical documentation.`;
  } else if (category === "eligibility") {
    categorySpecificGrounds = `4. The member was confirmed eligible for benefits at the time services were rendered.`;
  } else if (category === "timely_filing") {
    categorySpecificGrounds = `4. Records confirm the claim was submitted within the required filing window.`;
  }

  const hasAnalysis = Object.keys(denialCodeAnalysis).length > 0 || denialCodes.length > 0;

  const content = `Grounds for Appeal:

1. The denial reason cited does not fully account for the documented clinical findings and prior treatment history.
2. ${hasAnalysis ? "The applicable denial code interpretation suggests an administrative or documentation-based issue rather than a lack of medical necessity." : "The stated denial rationale does not align with the clinical documentation and supporting evidence provided."}
3. All required identifiers and claim information are clearly provided above to ensure accurate review.${categorySpecificGrounds ? "\n" + categorySpecificGrounds : ""}`;

  return {
    id: "grounds_for_appeal",
    title: "Grounds for Appeal",
    content,
    citations,
  };
}

function buildAttachmentsSection(
  dc: DenialCase,
  chunks: RetrievedChunk[]
): LetterSection {
  const required = val(dc.requiredAttachments) ?? [];
  const category = val(dc.denialCategory) ?? "other";

  const baseAttachments = [
    "Letter of Medical Necessity",
    "Relevant Progress Notes",
    "Procedure Documentation",
    "Supporting Clinical Literature (if applicable)",
    "Copy of Explanation of Benefits",
    ...required,
    ...(category === "benefit_limit" || category === "medical_necessity"
      ? ["Functional Outcome Measures", "Treatment Plan (initial and current)"]
      : []),
    ...(category === "coding"
      ? ["AMA CPT Code Definition Documentation"]
      : []),
  ];

  const unique = [...new Set(baseAttachments)];

  const citations: Citation[] = [
    ...spans(dc.requiredAttachments).map((s) => spanToCitation(s, "requiredAttachments")),
    ...chunks
      .filter((c) => c.meta.docType === "clinical")
      .slice(0, 2)
      .map((c) => chunkToCitation(c, "clinical_evidence")),
  ];

  const content = `Attached Documentation:
${unique.map((a) => `- ${a}`).join("\n")}`;

  return { id: "attachments", title: "Attached Documentation", content, citations };
}

function buildExtractionVerificationSection(
  dc: DenialCase,
  userContext: UserContext
): LetterSection {
  const notes = dc.extraction_notes ?? {};

  const content = `Trust & Extraction Verification (for internal review alignment):

Extraction Notes:
- Patient Name Found: ${notes.patient_name_found ?? false}
- Patient Address Found: ${notes.patient_address_found ?? false}
- Identifiers Found: ${notes.identifiers_found ?? false}
- Claim ID Found: ${notes.claim_id_found ?? false}
- Denial Codes Found: ${notes.denial_codes_found ?? false}
- Denial Reason Found: ${notes.denial_reason_found ?? false}

All extracted identifiers and claim data have been included to ensure precise matching of this appeal to the correct member account and claim record.`;

  return { id: "extraction_verification", title: "Extraction Verification", content, citations: [] };
}

function buildClosingSection(
  dc: DenialCase,
  userContext: UserContext
): LetterSection {
  const f = resolveFields(dc, userContext);

  const citations: Citation[] = [
    ...spans(dc.memberName).map((s) => spanToCitation(s, "memberName")),
    ...spans(dc.appealWindowDays).map((s) => spanToCitation(s, "appealWindowDays")),
  ];

  const content = `I respectfully request a comprehensive reconsideration of this claim in light of the enclosed documentation and clarification of the denial rationale. If additional information is required, please contact me at the phone number on file or reach out directly to the treating provider listed in the medical documentation.

Thank you for your prompt attention to this matter. I look forward to your timely response and a favorable resolution.

Sincerely,

${f.patientName}
${f.patientAddress}
${f.phone}
${f.email}`;

  return { id: "closing", title: "Closing and Signature", content, citations };
}

// ─── LLM-Enhanced Generation (Claude / Anthropic) ────────────────────────

async function generateWithClaude(
  dc: DenialCase,
  chunks: RetrievedChunk[],
  userContext: UserContext,
  opts: GenerateOptions
): Promise<LetterSection[] | null> {
  if (!config.anthropicApiKey) return null;

  try {
    const Anthropic = require("@anthropic-ai/sdk") as {
      default: new (opts: { apiKey: string }) => {
        messages: {
          create: (opts: {
            model: string;
            max_tokens: number;
            messages: Array<{ role: string; content: string }>;
            system: string;
            temperature: number;
          }) => Promise<{
            content: Array<{ type: string; text?: string }>;
          }>;
        };
      };
    };

    const client = new Anthropic.default({ apiKey: config.anthropicApiKey });

    const caseContext = formatDenialCaseForPrompt(dc);
    const kbContext = chunks
      .slice(0, 10)
      .map(
        (c, i) =>
          `[KB_CHUNK_${i}] DocType: ${c.meta.docType} | ChunkId: ${c.chunkId}\n${c.text}`
      )
      .join("\n\n---\n\n");

    const denialCodes = dc.denial_codes ?? [];
    const denialCodeAnalysis = dc.denial_code_analysis ?? {};
    const codeContext = denialCodes.length > 0
      ? `\nDENIAL CODES AND ANALYSIS:\n${denialCodes.map((code) => {
          const analysis = denialCodeAnalysis[code];
          return analysis ? `- ${code}: ${analysis}` : `- ${code}`;
        }).join("\n")}`
      : "";

    const systemPrompt = `You are a medical claims appeal specialist generating a formal appeal letter.

STRICT RULES — NEVER VIOLATE:
1. Use ONLY facts, numbers, dates, and policies from the DENIAL CASE, DENIAL CODES, and KB CHUNKS provided below.
2. Do NOT invent payer addresses, fax numbers, policy names, session counts, dollar amounts, or medical facts.
3. For any claim you cannot support with the provided evidence, write exactly: [NEEDS EVIDENCE: brief description]
4. Every paragraph containing a dollar amount, date, session count, or CPT code MUST cite its source.
5. Tone: ${opts.tone ?? "professional"}
6. Use the denial codes and their human-readable analysis to craft specific, targeted rebuttals.
7. Reference specific RAG knowledge base chunks when making policy or clinical arguments.
${userContext.customInstructions ? `\nADDITIONAL INSTRUCTIONS FROM USER: ${userContext.customInstructions}` : ""}

OUTPUT FORMAT — return valid JSON (no markdown fences):
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

Sections to generate (all of them, following this EXACT appeal letter template):
1. header (id: "header") — Date, insurance company, patient info, claim ID, identifiers
2. opening (id: "opening") — Formal opening referencing the claim denial
3. denial_codes (id: "denial_codes") — List denial codes, verbatim denial reason, and human-readable analysis
4. clinical_context (id: "clinical_context") — Clinical context and medical necessity argument
5. grounds_for_appeal (id: "grounds_for_appeal") — Numbered grounds for appeal tailored to the denial category
6. attachments (id: "attachments") — List of attached documentation
7. extraction_verification (id: "extraction_verification") — Trust & extraction verification notes
8. closing (id: "closing") — Closing request, signature, contact info`;

    const userMsg = `DENIAL CASE:
${caseContext}
${codeContext}

RETRIEVED KNOWLEDGE BASE (RAG context — use these for grounded arguments):
${kbContext || "(no KB documents ingested — use NEEDS EVIDENCE placeholders)"}

USER CONTEXT:
${JSON.stringify(userContext, null, 2)}

Generate a complete, grounded appeal letter. Every factual claim must be cited or marked [NEEDS EVIDENCE]. Use the denial codes and KB context to build specific, targeted arguments.`;

    const response = await client.messages.create({
      model: config.anthropicModel,
      max_tokens: 8192,
      system: systemPrompt,
      messages: [
        { role: "user", content: userMsg },
      ],
      temperature: 0.1,
    });

    const textBlock = response.content.find((b: { type: string; text?: string }) => b.type === "text");
    const raw = textBlock?.text;
    if (!raw) return null;

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]) as {
      sections: Array<{
        id: string;
        title: string;
        content: string;
        citationIds: string[];
      }>;
    };

    return parsed.sections.map((s) => {
      const citations: Citation[] = [];
      for (const cid of s.citationIds ?? []) {
        if (cid.startsWith("KB_CHUNK_")) {
          const idx = parseInt(cid.replace("KB_CHUNK_", ""), 10);
          const chunk = chunks[idx];
          if (chunk) citations.push(chunkToCitation(chunk, `llm:${chunk.meta.docType}`));
        } else if (cid.startsWith("DENIAL_CASE_SPAN:")) {
          const label = cid.replace("DENIAL_CASE_SPAN:", "");
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
    log("warn", "Claude LLM generation failed — falling back to template", err);
    return null;
  }
}

// Legacy OpenAI fallback (kept for backward compat if OPENAI_API_KEY is set but not ANTHROPIC)
async function generateWithOpenAI(
  dc: DenialCase,
  chunks: RetrievedChunk[],
  userContext: UserContext,
  opts: GenerateOptions
): Promise<LetterSection[] | null> {
  if (!config.openaiApiKey || config.anthropicApiKey) return null;

  try {
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
1. Use ONLY facts from the DENIAL CASE and KB CHUNKS provided below.
2. Do NOT invent facts. For unsupported claims write: [NEEDS EVIDENCE: brief description]
3. Tone: ${opts.tone ?? "professional"}

OUTPUT FORMAT — return valid JSON:
{
  "sections": [
    {
      "id": "section_id",
      "title": "Section Title",
      "content": "Section content text",
      "citationIds": ["KB_CHUNK_0", "DENIAL_CASE_SPAN:memberName"]
    }
  ]
}

Sections: header, opening, denial_codes, clinical_context, grounds_for_appeal, attachments, extraction_verification, closing`;

    const response = await client.chat.completions.create({
      model: config.openaiModel,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `DENIAL CASE:\n${caseContext}\n\nKB:\n${kbContext || "(none)"}\n\nUSER CONTEXT:\n${JSON.stringify(userContext, null, 2)}` },
      ],
      temperature: 0.1,
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

    return parsed.sections.map((s) => {
      const citations: Citation[] = [];
      for (const cid of s.citationIds ?? []) {
        if (cid.startsWith("KB_CHUNK_")) {
          const idx = parseInt(cid.replace("KB_CHUNK_", ""), 10);
          const chunk = chunks[idx];
          if (chunk) citations.push(chunkToCitation(chunk, `llm:${chunk.meta.docType}`));
        } else if (cid.startsWith("DENIAL_CASE_SPAN:")) {
          const label = cid.replace("DENIAL_CASE_SPAN:", "");
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
          citations.push(...matchingSpans.map((span) => spanToCitation(span, label)));
        }
      }
      return { id: s.id, title: s.title, content: s.content, citations } as LetterSection;
    });
  } catch (err) {
    log("warn", "OpenAI generation failed — falling back to template", err);
    return null;
  }
}

function formatDenialCaseForPrompt(dc: DenialCase): string {
  const f = <T>(label: string, field: { value: T | null }): string =>
    `${label}: ${field.value !== null ? JSON.stringify(field.value) : "(not found)"}`;

  const flat = (label: string, v: unknown): string =>
    v != null ? `${label}: ${JSON.stringify(v)}` : "";

  const lines = [
    f("Payer Name", dc.payerName),
    f("Payer Address", dc.payerAddress),
    f("Letter Date", dc.letterDate),
    flat("Patient Name (parsed)", dc.patient_name) || f("Member Name", dc.memberName),
    flat("Patient Address (parsed)", dc.patient_address),
    flat("Identifiers (parsed)", dc.identifiers),
    flat("Claim ID (parsed)", dc.claim_id) || f("Claim Number", dc.claimNumber),
    f("Member ID", dc.memberId),
    f("Provider Name", dc.providerName),
    f("Service Date", dc.serviceDate),
    f("Services", dc.services),
    f("Denial Category", dc.denialCategory),
    flat("Denial Codes (parsed)", dc.denial_codes),
    flat("Denial Reason Text (parsed)", dc.denial_reason_text) || f("Denial Reason", dc.denialReasonSummary),
    flat("Denial Code Analysis (parsed)", dc.denial_code_analysis),
    f("Policy References", dc.policyReferences),
    f("Patient Responsibility", dc.patientResponsibilityAmount),
    f("Appeal Window Days", dc.appealWindowDays),
    f("Appeal Submission Methods", dc.appealSubmissionMethods),
    f("Appeal Instructions", dc.appealInstructions),
    f("Required Attachments", dc.requiredAttachments),
    flat("Extraction Notes", dc.extraction_notes),
  ].filter(Boolean);

  return lines.join("\n");
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

  items.push({
    priority: "p0",
    action: appealDays
      ? `Confirm and calendar the appeal deadline: ${appealDays} days from the denial letter date. File before this date to preserve your rights.`
      : "Confirm the appeal deadline from the denial letter. [NEEDS EVIDENCE: appeal window not extracted]",
    why: "Missing the appeal deadline permanently waives your right to an internal appeal.",
    citations,
  });

  if (category === "benefit_limit" || category === "medical_necessity") {
    const hasClinical = chunks.some((c) => c.meta.docType === "clinical");
    items.push({
      priority: "p0",
      action: hasClinical
        ? "Obtain complete PT/clinical progress notes for all treatment sessions and include them in the appeal packet."
        : "Contact provider to obtain: (1) progress notes, (2) functional outcome measures, (3) physician letter of medical necessity.",
      why: category === "benefit_limit"
        ? "Benefit limit exceptions require documented functional improvement and clinical necessity."
        : "Medical necessity denials are overturned most reliably with complete clinical documentation.",
      citations: chunks
        .filter((c) => c.meta.docType === "clinical")
        .slice(0, 1)
        .map((c) => chunkToCitation(c, "clinical")),
    });
  }

  items.push({
    priority: "p1",
    action: "Request a physician letter of medical necessity addressing the specific denial reason.",
    why: "A physician's direct attestation carries significant weight in the clinical review process.",
    citations: spans(dc.denialReasonSummary).map((s) => spanToCitation(s, "denialReason")),
  });

  const policyRefs = val(dc.policyReferences) ?? [];
  if (policyRefs.length > 0) {
    const hasPolicyChunk = chunks.some((c) => c.meta.docType === "policy");
    items.push({
      priority: "p1",
      action: hasPolicyChunk
        ? `Review retrieved policy excerpts for ${policyRefs.map((p) => p.policyId).join(", ")} and ensure documentation satisfies every listed criterion.`
        : `Obtain ${policyRefs.map((p) => p.policyId).join(", ")} from the payer and ingest via kb.ingest.`,
      why: "Rebutting a policy-specific denial requires demonstrating compliance with that exact policy's criteria.",
      citations: spans(dc.policyReferences).map((s) => spanToCitation(s, "policyReferences")),
    });
  }

  items.push({
    priority: "p2",
    action: methods.length > 0
      ? `Submit appeal via ${methods.join(" or ")} and obtain proof of submission.`
      : "Confirm where to submit the appeal and retain proof.",
    why: "Proof of timely submission protects you if the payer claims non-receipt.",
    citations: spans(dc.appealSubmissionMethods).map((s) => spanToCitation(s, "submissionMethods")),
  });

  if (missingEvidence.length > 0) {
    items.push({
      priority: "p2",
      action: `Resolve missing evidence items before submission: ${missingEvidence.slice(0, 3).join("; ")}${missingEvidence.length > 3 ? ` (and ${missingEvidence.length - 3} more)` : ""}.`,
      why: "NEEDS EVIDENCE placeholders indicate gaps that weaken the appeal.",
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

  const items: Array<{ item: string; required: boolean }> = [
    { item: "Letter of Medical Necessity", required: true },
    { item: "Copy of Explanation of Benefits", required: true },
    { item: "Relevant Progress Notes", required: true },
    { item: "Procedure Documentation", required: true },
    ...required.map((r) => ({ item: r, required: true })),
    ...(category === "benefit_limit" || category === "medical_necessity"
      ? [
          { item: "Functional Outcome Measures", required: true },
          { item: "Treatment Plan (initial and current)", required: false },
        ]
      : []),
    { item: "Supporting Clinical Literature (if applicable)", required: false },
    { item: "Proof of submission", required: false },
  ];

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

  const chunks = retrieveForCase(store, denialCase);
  log("debug", "Retrieved KB chunks", { count: chunks.length });

  let sections: LetterSection[];

  // Prefer Claude, then OpenAI, then template
  const claudeSections = await generateWithClaude(denialCase, chunks, userContext, options);
  if (claudeSections && claudeSections.length >= 5) {
    log("info", "Using Claude LLM-generated sections");
    sections = claudeSections;
  } else {
    const openaiSections = await generateWithOpenAI(denialCase, chunks, userContext, options);
    if (openaiSections && openaiSections.length >= 5) {
      log("info", "Using OpenAI LLM-generated sections");
      sections = openaiSections;
    } else {
      log("info", "Using template-generated sections");
      sections = [
        buildHeaderSection(denialCase, userContext, options),
        buildOpeningSection(denialCase, userContext),
        buildDenialCodesSection(denialCase, chunks),
        buildClinicalContextSection(denialCase, chunks, userContext),
        buildGroundsForAppealSection(denialCase, chunks, userContext),
        buildAttachmentsSection(denialCase, chunks),
        buildExtractionVerificationSection(denialCase, userContext),
        buildClosingSection(denialCase, userContext),
      ];
    }
  }

  const { sections: verifiedSections, unresolvedClaims, warnings: verifyWarnings } =
    verifySections(sections);

  const missingEvidence = collectMissingEvidence(verifiedSections);
  const actionItems = buildActionItems(denialCase, missingEvidence, chunks);
  const attachmentChecklist = buildAttachmentChecklist(denialCase, chunks);
  const fullText = assembleFullText(verifiedSections, includeCitationsInline);

  const parsedFields: ParsedCaseFields = {
    patientName: denialCase.patient_name ?? denialCase.memberName.value,
    patientAddress: denialCase.patient_address ?? userContext.patientAddress ?? null,
    identifiers: denialCase.identifiers ?? (
      denialCase.memberId.value
        ? [{ label: "Member ID", value: denialCase.memberId.value }]
        : []
    ),
    claimId: denialCase.claim_id ?? denialCase.claimNumber.value,
    denialCodes: denialCase.denial_codes ?? [],
    denialReasonText: denialCase.denial_reason_text ?? denialCase.denialReasonSummary.value,
    denialCodeAnalysis: denialCase.denial_code_analysis ?? null,
    extractionNotes: denialCase.extraction_notes ?? null,
  };

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
    parsedFields,
  };
}
