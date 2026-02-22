import type { MCPServer } from "mcp-use/server";
import { object, text } from "mcp-use/server";

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
} from "../schemas/tool-schemas.js";
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
      description:
        "Generates a structured markdown appeal letter from claim denial context.",
      schema: generateAppealDraftSchema,
    },
    async (input) => {
      try {
        const parsedInput = generateAppealDraftSchema.parse(input);
        const markdownDraft = appealGenerationService.generateAppealDraft(
          parsedInput
        );
        return text(markdownDraft);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Invalid appeal payload.";
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
}
