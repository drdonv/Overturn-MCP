import "dotenv/config";

import fs from "node:fs/promises";
import path from "node:path";

import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { MCPServer, error, object, text } from "mcp-use/server";
import { PDFParse } from "pdf-parse";
import { z } from "zod";

type McpErrorCode =
  | "MCP_INVALID_INPUT"
  | "MCP_RESOURCE_UNREADABLE"
  | "MCP_INTERNAL_ERROR";

const DenialMapping = {
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
    title:
      "Expenses incurred after coverage terminated",
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

const denialKnowledgeBase: Record<string, string> = {
  "16": "CARC 16 often indicates missing claim data, invalid coding details, or absent documentation required for payment review.",
  "22": "CARC 22 typically points to Coordination of Benefits conflicts where another carrier must adjudicate first.",
  "27": "CARC 27 indicates services rendered after termination of policy coverage or outside active eligibility windows.",
  "45": "CARC 45 is commonly tied to fee schedule reductions, contractual adjustments, or maximum allowable limits.",
  "96": "CARC 96 is used for non-covered services and may require benefit interpretation or exception-based appeal support.",
};

const extractClaimDataSchema = z.object({
  file_path: z
    .string()
    .min(1)
    .describe("Absolute or workspace-relative path to the denial PDF file"),
});

const analyzeDenialCodesSchema = z.object({
  denial_codes: z
    .array(z.string().min(1))
    .min(1)
    .describe("Array of payer denial codes, e.g. ['CO-45', '16']"),
});

const generateAppealDraftSchema = z.object({
  original_claim_id: z.string().min(1),
  denial_reason: z.string().min(1),
  clinical_justification_text: z.string().min(1),
});

const extractAndAnalyzeDenialSchema = z.object({
  file_path: z
    .string()
    .min(1)
    .describe("Absolute or workspace-relative path to the denial PDF file"),
});

const identifierSchema = z.object({
  label: z.string(),
  value: z.string(),
});

const parsedDenialFieldsSchema = z.object({
  claim_id: z.string().default("UNKNOWN"),
  patient_name: z.string().default("UNKNOWN"),
  patient_address: z.string().default("UNKNOWN"),
  identifiers: z.array(identifierSchema).default([]),
  denial_codes: z.array(z.string()).default([]),
  cpt_codes: z.array(z.string()).default([]),
  policy_references: z.array(z.string()).default([]),
  denial_reason_text: z.string().default("Reason not clearly found in document."),
});

type ParsedDenialFields = z.infer<typeof parsedDenialFieldsSchema>;

const DENIAL_PARSING_PROMPTS = {
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
    [
      "Extract denial fields from this text.",
      "",
      "Text:",
      rawText.slice(0, 15000),
    ].join("\n"),
} as const;

const mcpErrorResponse = (code: McpErrorCode, message: string) =>
  error(`[${code}] ${message}`);

const getErrorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

const classifyPdfError = (
  err: unknown
): { code: McpErrorCode; message: string } => {
  const message = getErrorMessage(err);
  const lower = message.toLowerCase();

  if (/password|encrypted|encryption/i.test(message)) {
    return {
      code: "MCP_RESOURCE_UNREADABLE",
      message:
        "The PDF appears encrypted/password-protected and cannot be parsed.",
    };
  }

  if (/enoent|no such file|eisdir|enotdir/i.test(lower)) {
    return {
      code: "MCP_INVALID_INPUT",
      message: "Invalid file path. Ensure the PDF exists and is readable.",
    };
  }

  if (/eacces|eperm|permission denied/i.test(lower)) {
    return {
      code: "MCP_RESOURCE_UNREADABLE",
      message: "Permission denied while reading the PDF file path.",
    };
  }

  if (/invalid pdf|format error|corrupt|xref|bad xref/i.test(lower)) {
    return {
      code: "MCP_RESOURCE_UNREADABLE",
      message: `PDF parsing failed. The file may be malformed or unsupported. Details: ${message}`,
    };
  }

  return {
    code: "MCP_RESOURCE_UNREADABLE",
    message: `Failed to read or parse the PDF denial document. Details: ${message}`,
  };
};

const normalizeCode = (rawCode: string): string => {
  const cleaned = rawCode.trim().toUpperCase().split(/\s+/).join("");
  const trailingDigitsRegex = /(\d{1,3})$/;
  const digits = trailingDigitsRegex.exec(cleaned)?.[1];
  return digits ?? cleaned;
};

class PdfExtractionService {
  async extractClaimData(filePath: string) {
    const resolvedPath = path.resolve(filePath);
    const fileBuffer = await fs.readFile(resolvedPath);
    const parser = new PDFParse({ data: fileBuffer });
    try {
      const textResult = await parser.getText();
      let info: Record<string, unknown> = {};
      let fingerprints: Array<string | null> = [];
      let infoParseError: string | undefined;

      try {
        const infoResult = await parser.getInfo();
        info = (infoResult.info ?? {}) as Record<string, unknown>;
        fingerprints = infoResult.fingerprints ?? [];
      } catch (err) {
        infoParseError = getErrorMessage(err);
      }

      return {
        file_path: resolvedPath,
        raw_text: (textResult.text ?? "").trim(),
        metadata: {
          pages: textResult.total ?? 0,
          info,
          fingerprints,
          info_parse_error: infoParseError,
        },
      };
    } finally {
      await parser.destroy();
    }
  }
}

class DenialAnalysisService {
  analyzeCodes(codes: string[]) {
    return codes.map((code) => {
      const normalizedCode = normalizeCode(code);
      const mapped = DenialMapping[normalizedCode as keyof typeof DenialMapping];

      if (!mapped) {
        return {
          input_code: code,
          normalized_code: normalizedCode,
          found: false,
          explanation:
            "Unknown code in local CARC dictionary. Use denial-knowledge-base resource for additional context.",
        };
      }

      return {
        input_code: code,
        normalized_code: normalizedCode,
        found: true,
        title: mapped.title,
        explanation: mapped.explanation,
        recommended_action: mapped.recommendedAction,
      };
    });
  }
}

class RegexDenialParsingService {
  private readonly claimPatterns = [
    /(?:claim\s*(?:id|number|no\.?|#)\s*[:#-]?\s*)([A-Z0-9-]{5,})/i,
    /(?:control\s*number\s*[:#-]?\s*)([A-Z0-9-]{5,})/i,
  ];

  private readonly denialReasonPattern =
    /(?:denial\s*reason|reason\s*for\s*denial|explanation(?:\s*of\s*benefits)?)[\s:.-]*([\s\S]{0,1200})/i;

  parseFromRawText(rawText: string) {
    const normalizedText = rawText.split("\r").join("\n");
    const claimId = this.extractClaimId(normalizedText);
    const patientName = this.extractPatientName(normalizedText);
    const patientAddress = this.extractPatientAddress(normalizedText);
    const denialCodes = this.extractDenialCodes(normalizedText);
    const cptCodes = this.extractCptCodes(normalizedText);
    const denialReason = this.extractDenialReason(normalizedText);
    const identifiers = this.extractIdentifiers(normalizedText);

    return {
      claim_id: claimId,
      patient_name: patientName,
      patient_address: patientAddress,
      identifiers,
      denial_codes: denialCodes,
      cpt_codes: cptCodes,
      policy_references: [] as string[],
      denial_reason_text: denialReason,
      extraction_notes: {
        claim_id_found: claimId !== "UNKNOWN",
        patient_name_found: patientName !== "UNKNOWN",
        patient_address_found: patientAddress !== "UNKNOWN",
        identifiers_found: identifiers.length > 0,
        denial_codes_found: denialCodes.length > 0,
        cpt_codes_found: cptCodes.length > 0,
        denial_reason_found:
          denialReason !== "Reason not clearly found in document.",
      },
    };
  }

  private extractClaimId(rawText: string): string {
    for (const pattern of this.claimPatterns) {
      const match = pattern.exec(rawText);
      if (match?.[1]) {
        return match[1].trim();
      }
    }
    return "UNKNOWN";
  }

  private extractDenialCodes(rawText: string): string[] {
    const withGroupCode = Array.from(
      rawText.matchAll(/\b(?:CO|PR|OA|PI)\s*-\s*\d{1,3}\b/gi)
    ).map((match) => match[0].split(/\s+/).join(""));

    const knownStandalone = Object.keys(DenialMapping).filter((code) =>
      new RegExp(String.raw`\b${code}\b`).test(rawText)
    );

    return Array.from(new Set([...withGroupCode, ...knownStandalone]));
  }

  private extractCptCodes(rawText: string): string[] {
    const labelledCodes = Array.from(
      rawText.matchAll(
        /\b(?:cpt|hcpcs|procedure\s*code|proc\s*code)\s*[:#-]?\s*([A-Z]?\d{4,5})\b/gi
      )
    ).map((match) => match[1].toUpperCase());
    return Array.from(new Set(labelledCodes));
  }

  private extractDenialReason(rawText: string): string {
    const match = this.denialReasonPattern.exec(rawText);
    const firstParagraph = match?.[1]?.split(/\n{2,}/)[0]?.trim();
    if (firstParagraph && firstParagraph.length >= 20) {
      return firstParagraph;
    }
    return "Reason not clearly found in document.";
  }

  private extractPatientName(rawText: string): string {
    const patterns = [
      /(?:patient\s*name|member\s*name|subscriber\s*name)\s*[:#-]?\s*([A-Z][A-Z ,.'-]{3,})/i,
      /(?:name)\s*[:#-]?\s*([A-Z][A-Z ,.'-]{3,})/i,
    ];
    for (const pattern of patterns) {
      const match = pattern.exec(rawText);
      if (match?.[1]) {
        return this.toTitleCase(match[1].trim());
      }
    }
    return "UNKNOWN";
  }

  private extractPatientAddress(rawText: string): string {
    const lines = rawText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    const zipRegex = /\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/i;
    for (let i = 0; i < lines.length - 1; i += 1) {
      const current = lines[i];
      const next = lines[i + 1];
      if (/\d{1,5}\s+[A-Z0-9 .'-]{3,}/i.test(current) && zipRegex.test(next)) {
        return `${this.toTitleCase(current)}, ${next.toUpperCase()}`;
      }
    }
    return "UNKNOWN";
  }

  private extractIdentifiers(rawText: string): Array<{
    label: string;
    value: string;
  }> {
    const items: Array<{ label: string; value: string }> = [];

    const labelPatterns = [
      String.raw`member\s*id`,
      String.raw`subscriber\s*id`,
      String.raw`account\s*#?`,
      String.raw`policy\s*#?`,
      String.raw`reference\s*#?`,
      String.raw`auth\s*#?`,
      String.raw`authorization\s*#?`,
    ];

    for (const labelPattern of labelPatterns) {
      const regex = new RegExp(
        String.raw`\b(${labelPattern})\s*[:#-]?\s*([A-Z0-9-]{4,})`,
        "gi"
      );
      for (const match of rawText.matchAll(regex)) {
        const label = match[1]?.trim();
        const value = match[2]?.trim();
        if (label && value) {
          items.push({
            label: label.toLowerCase().split(/\s+/).join("_"),
            value,
          });
        }
      }
    }

    const deduped = new Map<string, { label: string; value: string }>();
    for (const item of items) {
      deduped.set(`${item.label}:${item.value}`, item);
    }
    return Array.from(deduped.values());
  }

  private toTitleCase(value: string): string {
    return value
      .toLowerCase()
      .split(/\s+/)
      .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
      .join(" ");
  }
}

class LlmDenialParsingService {
  private readonly model: string;
  private readonly client: GoogleGenerativeAI | null;
  private readonly claudeClient: Anthropic | null;

  constructor() {
    const useClaudeParser = process.env.USE_CLAUDE_PARSER === "true";

    this.model = process.env.GEMINI_MODEL ?? "gemini-3-flash-preview";
    this.client = process.env.GEMINI_API_KEY
      ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
      : null;
    this.claudeClient =
      useClaudeParser && process.env.ANTHROPIC_API_KEY
        ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
        : null;
  }

  async parseFromRawText(rawText: string) {
    if (!this.client) {
      throw new Error(
        "GEMINI_API_KEY is not set. Configure it in your .env file."
      );
    }

    const model = this.client.getGenerativeModel({
      model: this.model,
      generationConfig: {
        temperature: 0,
      },
    });

    const prompt = [
      DENIAL_PARSING_PROMPTS.system,
      "",
      DENIAL_PARSING_PROMPTS.userTemplate(rawText),
      "",
      "Return JSON only.",
    ].join("\n");

    const response = await model.generateContent(prompt);
    const textBlocks = response.response.text();

    if (!textBlocks) {
      throw new Error("Gemini returned an empty parsing response.");
    }

    const parsedJson = this.extractJsonObject(textBlocks);
    const normalizedFields = this.normalizeModelOutput(parsedJson);
    const parsedFields = parsedDenialFieldsSchema.parse(normalizedFields);

    return {
      ...parsedFields,
      denial_codes: Array.from(
        new Set(parsedFields.denial_codes.map((code) => code.trim()).filter(Boolean))
      ),
      cpt_codes: Array.from(
        new Set(parsedFields.cpt_codes.map((code) => code.trim()).filter(Boolean))
      ),
      extraction_notes: {
        claim_id_found: parsedFields.claim_id !== "UNKNOWN",
        patient_name_found: parsedFields.patient_name !== "UNKNOWN",
        patient_address_found: parsedFields.patient_address !== "UNKNOWN",
        identifiers_found: parsedFields.identifiers.length > 0,
        denial_codes_found: parsedFields.denial_codes.length > 0,
        cpt_codes_found: parsedFields.cpt_codes.length > 0,
        denial_reason_found:
          parsedFields.denial_reason_text !==
          "Reason not clearly found in document.",
      },
    };
  }

  private extractJsonObject(textContent: string): unknown {
    const firstBrace = textContent.indexOf("{");
    const lastBrace = textContent.lastIndexOf("}");
    if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
      throw new Error("Gemini response did not contain a valid JSON object.");
    }
    const candidate = textContent.slice(firstBrace, lastBrace + 1);
    return JSON.parse(candidate);
  }

  private normalizeModelOutput(raw: unknown): ParsedDenialFields {
    const input = this.ensureRecord(raw);

    const normalizedIdentifiers = this.normalizeIdentifiers(input.identifiers);
    const { denialCodes, policyReferencesFromCodes } = this.normalizeDenialCodes(
      input.denial_codes
    );
    const explicitPolicyReferences = this.normalizeStringArray(
      input.policy_references
    );

    return {
      claim_id: this.toKnownString(input.claim_id),
      patient_name: this.toKnownString(input.patient_name),
      patient_address: this.toKnownString(input.patient_address),
      identifiers: normalizedIdentifiers,
      denial_codes: denialCodes,
      cpt_codes: this.normalizeCptCodes(input.cpt_codes),
      policy_references: Array.from(
        new Set([...explicitPolicyReferences, ...policyReferencesFromCodes])
      ),
      denial_reason_text: this.toKnownString(
        input.denial_reason_text,
        "Reason not clearly found in document."
      ),
    };
  }

  private ensureRecord(value: unknown): Record<string, unknown> {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return {};
  }

  private toKnownString(value: unknown, fallback = "UNKNOWN"): string {
    if (typeof value !== "string") {
      return fallback;
    }
    const cleaned = value.trim();
    return cleaned.length > 0 ? cleaned : fallback;
  }

  private normalizeDenialCodes(value: unknown): {
    denialCodes: string[];
    policyReferencesFromCodes: string[];
  } {
    const rawValues = this.normalizeStringArray(value);
    const denialCodes: string[] = [];
    const policyReferencesFromCodes: string[] = [];

    for (const entry of rawValues) {
      if (this.isCarcLikeCode(entry)) {
        denialCodes.push(entry);
      } else {
        policyReferencesFromCodes.push(entry);
      }
    }

    return {
      denialCodes: Array.from(new Set(denialCodes)),
      policyReferencesFromCodes: Array.from(new Set(policyReferencesFromCodes)),
    };
  }

  private normalizeStringArray(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value
        .map((item) =>
          typeof item === "string" ? item.trim() : String(item ?? "").trim()
        )
        .filter(Boolean);
    }
    if (typeof value === "string") {
      return value
        .split(/[,\n;]/)
        .map((item) => item.trim())
        .filter(Boolean);
    }
    return [];
  }

  private normalizeCptCodes(value: unknown): string[] {
    const rawValues = this.normalizeStringArray(value);
    const extracted = new Set<string>();
    const codeRegex = /\b(?:[A-Z]\d{4}|\d{5})\b/g;
    for (const entry of rawValues) {
      for (const match of entry.toUpperCase().matchAll(codeRegex)) {
        extracted.add(match[0]);
      }
    }
    return Array.from(extracted);
  }

  private isCarcLikeCode(code: string): boolean {
    const cleaned = code.toUpperCase().split(/\s+/).join("");
    if (/^(CO|PR|OA|PI)-?\d{1,3}$/.test(cleaned)) {
      return true;
    }
    if (/^\d{1,3}$/.test(cleaned)) {
      return true;
    }
    if (/^CARC[:#-]?\d{1,3}$/.test(cleaned)) {
      return true;
    }
    return false;
  }

  private normalizeIdentifiers(
    value: unknown
  ): Array<{ label: string; value: string }> {
    if (!Array.isArray(value)) {
      return [];
    }

    const mapped = value
      .map((item) => this.normalizeIdentifierEntry(item))
      .filter((item): item is { label: string; value: string } => item !== null);

    const deduped = new Map<string, { label: string; value: string }>();
    for (const item of mapped) {
      deduped.set(`${item.label}:${item.value}`, item);
    }
    return Array.from(deduped.values());
  }

  private normalizeIdentifierEntry(
    item: unknown
  ): { label: string; value: string } | null {
    if (typeof item === "string") {
      const parts = item.split(/[:=-]/, 2).map((part) => part.trim());
      if (parts.length === 2 && parts[0] && parts[1]) {
        return {
          label: parts[0].toLowerCase().split(/\s+/).join("_"),
          value: parts[1],
        };
      }
      return null;
    }

    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return null;
    }

    const record = item as Record<string, unknown>;
    const label = this.toKnownString(record.label, "").toLowerCase();
    const value = this.toKnownString(record.value, "");
    if (!label || !value) {
      return null;
    }
    return {
      label: label.split(/\s+/).join("_"),
      value,
    };
  }
}

class AppealGenerationService {
  generateAppealDraft(input: z.infer<typeof generateAppealDraftSchema>): string {
    const today = new Date().toISOString().slice(0, 10);
    return [
      `# Appeal Letter - Claim ${input.original_claim_id}`,
      "",
      `**Date:** ${today}`,
      `**Claim ID:** ${input.original_claim_id}`,
      "",
      "To: Claims Review Department",
      "",
      "## Re: Request for Reconsideration",
      "",
      `I am writing to formally appeal the denial of claim **${input.original_claim_id}**.`,
      "",
      "### Denial Reason Cited by Payer",
      input.denial_reason,
      "",
      "### Clinical Justification",
      input.clinical_justification_text,
      "",
      "### Request",
      "Based on the documentation and clinical rationale above, please reconsider and reprocess this claim for payment.",
      "",
      "Sincerely,",
      "",
      "[Provider Name]",
      "[Title]",
      "[Organization]",
    ].join("\n");
  }
}

const pdfExtractionService = new PdfExtractionService();
const denialAnalysisService = new DenialAnalysisService();
const regexDenialParsingService = new RegexDenialParsingService();
const llmDenialParsingService = new LlmDenialParsingService();
const appealGenerationService = new AppealGenerationService();

const server = new MCPServer({
  name: "hicda-mcp-server",
  title: "Health Insurance Claim Denial Analyzer",
  version: "1.0.0",
  description:
    "MCP server for denial PDF extraction, denial code interpretation, and appeal draft generation.",
});

/**
 * LLM orchestration guidance:
 * 1) Call `extract_claim_data` first to ingest denial notice text and metadata.
 * 2) Parse/identify denial codes and call `analyze_denial_codes` for human-readable interpretation.
 * 3) Use payer rationale + chart context to call `generate_appeal_draft` and produce a clinician-ready markdown appeal.
 */
server.tool(
  {
    name: "extract_claim_data",
    description:
      "Extracts raw text and metadata from an insurance denial PDF.",
    schema: extractClaimDataSchema,
  },
  async (input) => {
    try {
      const parsedInput = extractClaimDataSchema.parse(input);
      const extracted = await pdfExtractionService.extractClaimData(
        parsedInput.file_path
      );
      return object(extracted);
    } catch (err) {
      const classified = classifyPdfError(err);
      process.stderr.write(
        `[extract_claim_data] ${getErrorMessage(err)}\n`
      );
      return mcpErrorResponse(classified.code, classified.message);
    }
  }
);

server.tool(
  {
    name: "extract_and_analyze_denial",
    description:
      "Demo one-shot workflow: extract PDF text, parse claim/denial fields, and map denial codes to human-readable explanations.",
    schema: extractAndAnalyzeDenialSchema,
  },
  async (input) => {
    try {
      const parsedInput = extractAndAnalyzeDenialSchema.parse(input);
      const extracted = await pdfExtractionService.extractClaimData(
        parsedInput.file_path
      );

      // Legacy deterministic parser kept as fallback/reference for hackathon iteration.
      const regexParsedFields = regexDenialParsingService.parseFromRawText(
        extracted.raw_text
      );

      // Commented out old flow to preserve prior behavior reference:
      // const parsedFields = regexDenialParsingService.parseFromRawText(extracted.raw_text);

      let parsedFields = regexParsedFields;
      let parsingSource: "regex" | "llm" | "hybrid" = "regex";
      const parsingWarnings: string[] = [];

      try {
        const llmParsedFields = await llmDenialParsingService.parseFromRawText(
          extracted.raw_text
        );
        parsedFields = {
          ...llmParsedFields,
          denial_codes:
            llmParsedFields.denial_codes.length > 0
              ? llmParsedFields.denial_codes
              : regexParsedFields.denial_codes,
        };
        parsingSource =
          regexParsedFields.denial_codes.length > 0 &&
          llmParsedFields.denial_codes.length > 0
            ? "hybrid"
            : "llm";
      } catch (error_) {
        parsingWarnings.push(
          `LLM parsing unavailable. Fell back to regex parser. ${getErrorMessage(error_)}`
        );
      }

      const codeAnalysis = denialAnalysisService.analyzeCodes(
        parsedFields.denial_codes
      );

      return object({
        file_path: extracted.file_path,
        metadata: extracted.metadata,
        parsed_fields: parsedFields,
        parsing_source: parsingSource,
        parsing_warnings: parsingWarnings,
        denial_code_analysis: codeAnalysis,
      });
    } catch (err) {
      const classified = classifyPdfError(err);
      process.stderr.write(
        `[extract_and_analyze_denial] ${getErrorMessage(err)}\n`
      );
      return mcpErrorResponse(classified.code, classified.message);
    }
  }
);

server.tool(
  {
    name: "analyze_denial_codes",
    description:
      "Maps denial codes to human-readable CARC explanations and recommended actions.",
    schema: analyzeDenialCodesSchema,
  },
  async (input) => {
    try {
      const parsedInput = analyzeDenialCodesSchema.parse(input);
      const analysis = denialAnalysisService.analyzeCodes(parsedInput.denial_codes);
      return object({
        results: analysis,
        dictionary_size: Object.keys(DenialMapping).length,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid denial code payload.";
      return mcpErrorResponse("MCP_INVALID_INPUT", message);
    }
  }
);

server.tool(
  {
    name: "generate_appeal_draft",
    description:
      "Generates a structured markdown appeal letter from claim denial context.",
    schema: generateAppealDraftSchema,
  },
  async (input) => {
    try {
      const parsedInput = generateAppealDraftSchema.parse(input);
      const markdownDraft = appealGenerationService.generateAppealDraft(parsedInput);
      return text(markdownDraft);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid appeal payload.";
      return mcpErrorResponse("MCP_INVALID_INPUT", message);
    }
  }
);

server.resourceTemplate(
  {
    name: "denial-knowledge-base-code",
    uriTemplate: "denial-knowledge-base://codes/{code}",
    description: "Lookup denial code policy context and interpretation notes.",
    mimeType: "text/plain",
  },
  async (_uri: URL, params: Record<string, any>) => {
    const code = normalizeCode(String(params.code ?? ""));
    const note = denialKnowledgeBase[code];
    if (!note) {
      return text(
        `No entry found for code '${code}'. Consider payer policy docs and CARC/RARC references for deeper review.`
      );
    }
    return text(`Code ${code}: ${note}`);
  }
);

async function startServer(): Promise<void> {
  try {
    const transport = new StdioServerTransport();
    await server.nativeServer.connect(transport);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `[MCP_INTERNAL_ERROR] Failed to start stdio transport: ${message}\n`
    );
    process.exit(1);
  }
}

await startServer();
