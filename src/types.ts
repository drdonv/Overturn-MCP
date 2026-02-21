// ─── Denial Inspector MCP Compatibility ─────────────────────────────────────
// These types mirror denial-inspector-mcp outputs; accept them as direct JSON input.

export interface SourceSpan {
  docId: string;
  start: number;
  end: number;
  snippet: string;
  label: string;
}

export interface ExtractedField<T> {
  value: T | null;
  confidence: number;
  spans: SourceSpan[];
  notes?: string;
}

export type ServiceStatus = "DENIED" | "APPROVED" | "PARTIAL" | "UNKNOWN";

export interface ServiceItem {
  serviceName: string;
  cptCodes: string[];
  amountRequested: number | null;
  currency: string;
  status: ServiceStatus;
}

export type DenialCategory =
  | "medical_necessity"
  | "authorization"
  | "benefit_limit"
  | "coding"
  | "eligibility"
  | "timely_filing"
  | "other";

/** A labelled identifier pair from the updated extract_and_analyze_denial MCP. */
export interface Identifier {
  label: string;  // e.g. "member ID", "subscriber ID", "auth #"
  value: string;
}

/** Trust-indicator flags returned in extraction_notes by the updated denial-inspector-mcp. */
export interface ExtractionNotes {
  patient_name_found?: boolean;
  patient_address_found?: boolean;
  identifiers_found?: boolean;
  claim_id_found?: boolean;
  denial_codes_found?: boolean;
  denial_reason_found?: boolean;
  [key: string]: boolean | undefined;
}

export interface DenialCase {
  caseId: string;
  payerName: ExtractedField<string>;
  payerAddress: ExtractedField<string>;
  letterDate: ExtractedField<string>;
  memberName: ExtractedField<string>;
  memberId: ExtractedField<string>;
  claimNumber: ExtractedField<string>;
  providerName: ExtractedField<string>;
  serviceDate: ExtractedField<string>;
  services: ExtractedField<ServiceItem[]>;
  denialCategory: ExtractedField<DenialCategory>;
  denialReasonSummary: ExtractedField<string>;
  policyReferences: ExtractedField<Array<{ policyId: string; title?: string }>>;
  patientResponsibilityAmount: ExtractedField<number>;
  appealWindowDays: ExtractedField<number>;
  appealSubmissionMethods: ExtractedField<
    Array<"mail" | "fax" | "portal" | "phone" | "other">
  >;
  appealInstructions: ExtractedField<string>;
  requiredAttachments: ExtractedField<string[]>;
  missingInformation: ExtractedField<string[]>;
  rawText: string;
  docMeta: { docId: string; filename: string; mimeType: string };

  // ── New fields from updated extract_and_analyze_denial MCP (optional) ─────
  /** Patient's full name as parsed (preferred over memberName.value when present). */
  patient_name?: string | null;
  /** Patient's mailing address as parsed. */
  patient_address?: string | null;
  /**
   * All identified IDs extracted from the denial letter:
   * member ID, subscriber ID, account #, policy #, reference #, auth #, etc.
   */
  identifiers?: Identifier[];
  /** Primary claim/reference ID (preferred over claimNumber.value when present). */
  claim_id?: string | null;
  /** Raw denial code(s) from the letter (e.g. ["CO-4", "PR-31"]). */
  denial_codes?: string[];
  /** Verbatim denial reason text from the letter. */
  denial_reason_text?: string | null;
  /** Human-readable explanation mapped from denial_codes. */
  denial_code_analysis?: Record<string, string> | null;
  /** Trust indicator flags produced during extraction. */
  extraction_notes?: ExtractionNotes;
}

// ─── Knowledge Base Types ─────────────────────────────────────────────────────

export type DocType =
  | "policy"
  | "template"
  | "prior_appeal_accepted"
  | "prior_appeal_denied"
  | "clinical"
  | "benefits"
  | "other";

export interface KnowledgeDoc {
  docId: string;
  filename: string;
  mimeType: string;
  text: string;
  meta: {
    payerName?: string;
    docType: DocType;
    tags?: string[];
    createdAt?: string;
  };
}

export interface RetrievedChunk {
  chunkId: string;
  docId: string;
  text: string;
  score: number;
  spans: Array<{ start: number; end: number }>;
  meta: KnowledgeDoc["meta"];
}

// ─── Appeal Letter Types ──────────────────────────────────────────────────────

export type CitationKind = "denialCaseSpan" | "kbChunk";

export interface Citation {
  kind: CitationKind;
  docId: string;
  start: number;
  end: number;
  snippet: string;
  label: string;
}

export interface LetterSection {
  id: string;
  title: string;
  content: string;
  citations: Citation[];
  warnings?: string[];
}

/** Structured field summary exposed in AppealLetter for UI rendering. */
export interface ParsedCaseFields {
  patientName: string | null;
  patientAddress: string | null;
  identifiers: Identifier[];
  claimId: string | null;
  denialCodes: string[];
  denialReasonText: string | null;
  denialCodeAnalysis: Record<string, string> | null;
  extractionNotes: ExtractionNotes | null;
}

export interface AppealLetter {
  letterId: string;
  caseId: string;
  payerName: string | null;
  createdAt: string;
  tone: "professional" | "firm" | "concise";
  sections: LetterSection[];
  fullText: string;
  attachmentChecklist: Array<{
    item: string;
    required: boolean;
    citations: Citation[];
  }>;
  missingEvidence: string[];
  actionItems: Array<{
    priority: "p0" | "p1" | "p2";
    action: string;
    why: string;
    citations: Citation[];
  }>;
  /** Structured field summary for UI consumption. */
  parsedFields: ParsedCaseFields;
}

// ─── Argument Plan ────────────────────────────────────────────────────────────

export interface ArgumentPlan {
  primaryDenialCategory: string;
  thesis: string;
  arguments: Array<{
    claim: string;
    requiredEvidence: string[];
    retrievalQueries: string[];
  }>;
}

export interface PlanResult {
  plan: ArgumentPlan;
  retrievedContext: RetrievedChunk[];
  missingEvidence: string[];
  warnings: string[];
}

// ─── Tool Option Types ────────────────────────────────────────────────────────

export interface IngestOptions {
  chunkSize?: number;
  chunkOverlap?: number;
  maxChars?: number;
}

export interface GenerateOptions {
  tone?: "professional" | "firm" | "concise";
  includePatientCoverPage?: boolean;
  maxPagesHint?: number;
  includeCitationsInline?: boolean;
}

export interface UserContext {
  patientAddress?: string;
  patientPhone?: string;
  diagnosis?: string;
  providerContact?: string;
  requestedOutcome?: string;
  notes?: string;
  providerNpi?: string;
  providerTaxId?: string;
}

// ─── Internal Vector Store ────────────────────────────────────────────────────

export interface ChunkRecord {
  chunkId: string;
  docId: string;
  chunkIndex: number;
  text: string;
  vectorJson: string; // serialized Record<string, number>
}

export interface DocRecord {
  docId: string;
  filename: string;
  mimeType: string;
  text: string;
  payerName: string | null;
  docType: string;
  tagsJson: string;
  createdAt: string;
}
