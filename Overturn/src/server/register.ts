import type { MCPServer } from "mcp-use/server";
import { object, text, widget } from "mcp-use/server";

import { DenialMapping, denialKnowledgeBase } from "../constants/denial.js";
import { DenialAnalysisService } from "../services/denial-analysis.service.js";
import { AppealGenerationService } from "../services/appeal-generation.service.js";
import { LlmDenialParsingService } from "../services/llm-denial-parsing.service.js";
import { PdfExtractionService } from "../services/pdf-extraction.service.js";
import { RegexDenialParsingService } from "../services/regex-denial-parsing.service.js";
import {
  analyzeDenialCodesSchema,
  extractAndAnalyzeDenialSchema,
  extractClaimDataSchema,
  generateAppealDraftSchema,
  openOverturnDashboardSchema,
  loadDemoCaseSchema,
} from "../schemas/tool-schemas.js";
import { DEMO_CASES } from "../constants/demo-cases.js";
import {
  classifyPdfError,
  getErrorMessage,
  mcpErrorResponse,
} from "../utils/errors.js";
import { normalizeCode } from "../utils/normalization.js";

const pdfExtractionService = new PdfExtractionService();
const denialAnalysisService = new DenialAnalysisService();
const regexDenialParsingService = new RegexDenialParsingService();
const llmDenialParsingService = new LlmDenialParsingService();
const appealGenerationService = new AppealGenerationService();

/**
 * LLM orchestration guidance:
 * 1) Call `extract_claim_data` first to ingest denial notice text and metadata.
 * 2) Parse/identify denial codes and call `analyze_denial_codes` for human-readable interpretation.
 * 3) Use payer rationale + chart context to call `generate_appeal_draft` and produce a clinician-ready markdown appeal.
 */
export function registerServerHandlers(server: MCPServer): void {
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
        process.stderr.write(`[extract_claim_data] ${getErrorMessage(err)}\n`);
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

        const regexParsedFields = regexDenialParsingService.parseFromRawText(
          extracted.raw_text
        );

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

        const denialCodeAnalysisStrings = codeAnalysis
          .filter((a: any) => a.found)
          .map(
            (a: any) =>
              `${a.input_code}: ${a.title} — ${a.explanation} (Action: ${a.recommended_action})`
          );

        return object({
          file_path: extracted.file_path,
          metadata: extracted.metadata,
          parsed_fields: parsedFields,
          parsing_source: parsingSource,
          parsing_warnings: parsingWarnings,
          denial_code_analysis: codeAnalysis,
          denial_code_analysis_strings: denialCodeAnalysisStrings,
          appeal_ready_fields: {
            patient_name: parsedFields.patient_name,
            patient_address: parsedFields.patient_address,
            claim_id: parsedFields.claim_id,
            identifiers: parsedFields.identifiers,
            denial_codes: parsedFields.denial_codes,
            denial_reason_text: parsedFields.denial_reason_text,
            denial_code_analysis: denialCodeAnalysisStrings,
            cpt_codes: parsedFields.cpt_codes,
            policy_references: parsedFields.policy_references,
            extraction_notes: parsedFields.extraction_notes,
          },
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
        const analysis = denialAnalysisService.analyzeCodes(
          parsedInput.denial_codes
        );
        return object({
          results: analysis,
          dictionary_size: Object.keys(DenialMapping).length,
        });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Invalid denial code payload.";
        return mcpErrorResponse("MCP_INVALID_INPUT", message);
      }
    }
  );

  server.tool(
    {
      name: "generate_appeal_draft",
      description: [
        "Generates a formal appeal letter for a denied insurance claim.",
        "Uses the provided claim data to fill a structured template.",
        "When ANTHROPIC_API_KEY is set, enhances the letter with Claude AI using RAG context from the denial code knowledge base.",
        "All fields are optional — provide as many as available for the best result.",
        "Fields: patient_name, patient_address, claim_id, identifiers, denial_codes, denial_reason_text,",
        "denial_code_analysis, cpt_codes, policy_references, extraction_notes,",
        "insurance_company_name, insurance_company_address, phone_number, email_address,",
        "clinical_justification_text, custom_instructions, use_ai_enhancement.",
      ].join(" "),
      schema: generateAppealDraftSchema,
    },
    async (input) => {
      try {
        const parsedInput = generateAppealDraftSchema.parse(input);
        const appealLetter =
          await appealGenerationService.generateAppealDraft(parsedInput);
        return text(appealLetter);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Invalid appeal payload.";
        return mcpErrorResponse("MCP_INVALID_INPUT", message);
      }
    }
  );

  server.tool(
    {
      name: "load_demo_case",
      description:
        "Load a demo denial case for testing. Returns pre-built parsed fields, denial code analysis, and appeal-ready data. Call without case_id to list available demos. Available: demo_medical_necessity, demo_prior_auth, demo_coding_error.",
      schema: loadDemoCaseSchema,
    },
    async (input) => {
      const parsed = loadDemoCaseSchema.parse(input);

      if (!parsed.case_id) {
        return object({
          available_demos: DEMO_CASES.map((d) => ({
            id: d.id,
            title: d.title,
            description: d.description,
          })),
        });
      }

      const demo = DEMO_CASES.find((d) => d.id === parsed.case_id);
      if (!demo) {
        return object({
          error: `Demo case '${parsed.case_id}' not found.`,
          available_demos: DEMO_CASES.map((d) => d.id),
        });
      }

      const denialCodeAnalysisStrings = demo.denial_code_analysis
        .filter((a) => a.found)
        .map(
          (a) =>
            `${a.input_code}: ${a.title} — ${a.explanation} (Action: ${a.recommended_action})`
        );

      return object({
        demo_id: demo.id,
        title: demo.title,
        description: demo.description,
        parsed_fields: demo.parsed_fields,
        denial_code_analysis: demo.denial_code_analysis,
        denial_code_analysis_strings: denialCodeAnalysisStrings,
        appeal_ready_fields: {
          patient_name: demo.parsed_fields.patient_name,
          patient_address: demo.parsed_fields.patient_address,
          claim_id: demo.parsed_fields.claim_id,
          identifiers: demo.parsed_fields.identifiers,
          denial_codes: demo.parsed_fields.denial_codes,
          denial_reason_text: demo.parsed_fields.denial_reason_text,
          denial_code_analysis: denialCodeAnalysisStrings,
          cpt_codes: demo.parsed_fields.cpt_codes,
          policy_references: demo.parsed_fields.policy_references,
          extraction_notes: demo.parsed_fields.extraction_notes,
        },
      });
    }
  );

  server.tool(
    {
      name: "open_overturn_dashboard",
      description:
        "Opens the Overturn appeal dashboard widget. Use this to let the user process denial PDFs, view extracted claim data, generate appeal letters with Claude, and manage claims in one place. Optionally pass initial_file_path to pre-fill the PDF path.",
      schema: openOverturnDashboardSchema,
      widget: {
        name: "overturn-dashboard",
        invoking: "Opening Overturn dashboard…",
        invoked: "Dashboard ready",
      },
    },
    async (input) => {
      const parsed = openOverturnDashboardSchema.parse(input);
      const demos = DEMO_CASES.map((d) => ({
        id: d.id,
        title: d.title,
        description: d.description,
      }));
      return widget({
        props: {
          initial_file_path: parsed.initial_file_path,
          demos,
          claims: [],
        },
        output: text(
          parsed.initial_file_path
            ? `Overturn dashboard opened with PDF path: ${parsed.initial_file_path}. Use the widget to extract, generate appeal letter, and add to claims.`
            : "Overturn dashboard opened. Use the demo buttons or enter a denial PDF path to extract and generate an appeal letter."
        ),
      });
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
}
