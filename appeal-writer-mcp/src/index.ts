#!/usr/bin/env node
/**
 * appeal-writer-mcp — MCP server entry point.
 *
 * Tools exposed:
 *   kb.ingest            — ingest documents into the RAG knowledge base
 *   kb.search            — search the knowledge base
 *   appeal.plan          — generate argument plan for a denial case
 *   appeal.generate      — generate a full grounded appeal letter
 *   appeal.generateFromCaseId — generate from a stored case ID
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";

import { config, log } from "./config";
import { KBStore } from "./kb/store";
import { ingestDocuments, IngestInput } from "./kb/ingest";
import { searchKB } from "./kb/retrieve";
import { runPlan } from "./appeal/plan";
import { generateAppealLetter } from "./appeal/generate";
import {
  DenialCase,
  GenerateOptions,
  UserContext,
} from "./types";

// ─── Initialize Store ───────────────────────────────────────────────────────

const store = new KBStore(config.storagePath);
store.init();

// ─── MCP Server ─────────────────────────────────────────────────────────────

const server = new Server(
  { name: "appeal-writer-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// ─── Tool Definitions ────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "kb.ingest",
      description:
        "Ingest documents (PDF, DOCX, TXT) into the RAG knowledge base. Supports payer policies, clinical notes, prior accepted appeal letters, and benefit summaries.",
      inputSchema: {
        type: "object",
        properties: {
          documents: {
            type: "array",
            description: "List of documents to ingest",
            items: {
              type: "object",
              required: ["filename", "mimeType", "contentBase64", "meta"],
              properties: {
                docId: { type: "string", description: "Optional stable ID; auto-generated if omitted" },
                filename: { type: "string" },
                mimeType: {
                  type: "string",
                  description: "e.g. text/plain, application/pdf, application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                },
                contentBase64: { type: "string", description: "Base64-encoded file content" },
                meta: {
                  type: "object",
                  required: ["docType"],
                  properties: {
                    payerName: { type: "string" },
                    docType: {
                      type: "string",
                      enum: ["policy", "template", "prior_appeal_accepted", "prior_appeal_denied", "clinical", "benefits", "other"],
                    },
                    tags: { type: "array", items: { type: "string" } },
                    createdAt: { type: "string", description: "ISO date string" },
                  },
                },
              },
            },
          },
          options: {
            type: "object",
            properties: {
              chunkSize: { type: "number", default: 900 },
              chunkOverlap: { type: "number", default: 150 },
              maxChars: { type: "number", default: 800000 },
            },
          },
        },
        required: ["documents"],
      },
    },

    {
      name: "kb.search",
      description:
        "Search the knowledge base for chunks relevant to a query. Useful for exploring what evidence is available before generating an appeal.",
      inputSchema: {
        type: "object",
        required: ["query"],
        properties: {
          query: { type: "string", description: "Natural language search query" },
          filters: {
            type: "object",
            properties: {
              payerName: { type: "string" },
              docType: {
                type: "string",
                enum: ["policy", "template", "prior_appeal_accepted", "prior_appeal_denied", "clinical", "benefits", "other"],
              },
              tags: { type: "array", items: { type: "string" } },
            },
          },
          options: {
            type: "object",
            properties: {
              topK: { type: "number", default: 8 },
            },
          },
        },
      },
    },

    {
      name: "appeal.plan",
      description:
        "Generate an argument plan and evidence requirements for a denial case without writing the full letter. Use this to understand what evidence gaps exist before generating.",
      inputSchema: {
        type: "object",
        required: ["case"],
        properties: {
          case: {
            type: "object",
            description: "DenialCase object from denial-inspector-mcp",
          },
          userContext: {
            type: "object",
            properties: {
              diagnosis: { type: "string" },
              requestedOutcome: {
                type: "string",
                enum: ["pay_claim", "approve_service", "reprocess", "reduce_patient_resp", "other"],
              },
              providerNpi: { type: "string" },
              providerTaxId: { type: "string" },
              notes: { type: "string" },
            },
          },
        },
      },
    },

    {
      name: "appeal.generate",
      description:
        "Generate a complete, grounded appeal letter. Every factual claim is cited or marked [NEEDS EVIDENCE]. Returns sections, full text, attachment checklist, and action items.",
      inputSchema: {
        type: "object",
        required: ["case"],
        properties: {
          case: {
            type: "object",
            description: "DenialCase object from denial-inspector-mcp",
          },
          options: {
            type: "object",
            properties: {
              tone: {
                type: "string",
                enum: ["professional", "firm", "concise"],
                default: "professional",
              },
              includePatientCoverPage: { type: "boolean", default: true },
              maxPagesHint: { type: "number", default: 2 },
              includeCitationsInline: { type: "boolean", default: true },
            },
          },
          userContext: {
            type: "object",
            properties: {
              patientAddress: { type: "string" },
              patientPhone: { type: "string" },
              diagnosis: { type: "string" },
              providerContact: { type: "string" },
              requestedOutcome: { type: "string" },
              notes: { type: "string" },
            },
          },
          storeCaseForLookup: {
            type: "boolean",
            description: "If true, saves the case in the registry for appeal.generateFromCaseId",
            default: false,
          },
        },
      },
    },

    {
      name: "appeal.generateFromCaseId",
      description:
        "Generate an appeal letter from a previously stored case ID. Requires the case to have been saved via appeal.generate with storeCaseForLookup=true.",
      inputSchema: {
        type: "object",
        required: ["caseId"],
        properties: {
          caseId: { type: "string" },
          options: {
            type: "object",
            properties: {
              tone: { type: "string", enum: ["professional", "firm", "concise"] },
              includePatientCoverPage: { type: "boolean" },
              maxPagesHint: { type: "number" },
              includeCitationsInline: { type: "boolean" },
            },
          },
          userContext: {
            type: "object",
            properties: {
              patientAddress: { type: "string" },
              patientPhone: { type: "string" },
              diagnosis: { type: "string" },
              providerContact: { type: "string" },
              requestedOutcome: { type: "string" },
              notes: { type: "string" },
            },
          },
        },
      },
    },
  ],
}));

// ─── Tool Handlers ────────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  log("info", `Tool call: ${name}`);

  try {
    switch (name) {
      // ── kb.ingest ─────────────────────────────────────────────────────────
      case "kb.ingest": {
        const { documents, options } = args as {
          documents: IngestInput[];
          options?: { chunkSize?: number; chunkOverlap?: number; maxChars?: number };
        };

        if (!Array.isArray(documents) || documents.length === 0) {
          throw new McpError(ErrorCode.InvalidParams, "documents array is required and must not be empty");
        }

        const results = await ingestDocuments(store, documents, options ?? {});
        const warnings: string[] = [];
        const ingested = results.map((r) => {
          warnings.push(...r.warnings);
          return { docId: r.docId, chunks: r.chunks };
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ ingested, warnings }, null, 2),
            },
          ],
        };
      }

      // ── kb.search ────────────────────────────────────────────────────────
      case "kb.search": {
        const { query, filters, options } = args as {
          query: string;
          filters?: { payerName?: string; docType?: string; tags?: string[] };
          options?: { topK?: number };
        };

        if (!query?.trim()) {
          throw new McpError(ErrorCode.InvalidParams, "query is required");
        }

        const chunks = searchKB(store, query, filters ?? {}, options?.topK ?? 8);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ chunks }, null, 2),
            },
          ],
        };
      }

      // ── appeal.plan ──────────────────────────────────────────────────────
      case "appeal.plan": {
        const { case: denialCase, userContext } = args as {
          case: DenialCase;
          userContext?: UserContext;
        };

        if (!denialCase?.caseId) {
          throw new McpError(ErrorCode.InvalidParams, "case.caseId is required");
        }

        const result = runPlan(store, denialCase, userContext ?? {});
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      // ── appeal.generate ──────────────────────────────────────────────────
      case "appeal.generate": {
        const { case: denialCase, options, userContext, storeCaseForLookup } = args as {
          case: DenialCase;
          options?: GenerateOptions;
          userContext?: UserContext;
          storeCaseForLookup?: boolean;
        };

        if (!denialCase?.caseId) {
          throw new McpError(ErrorCode.InvalidParams, "case.caseId is required");
        }

        if (storeCaseForLookup) {
          store.saveCase(denialCase);
        }

        const letter = await generateAppealLetter(
          store,
          denialCase,
          options ?? {},
          userContext ?? {}
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(letter, null, 2),
            },
          ],
        };
      }

      // ── appeal.generateFromCaseId ────────────────────────────────────────
      case "appeal.generateFromCaseId": {
        const { caseId, options, userContext } = args as {
          caseId: string;
          options?: GenerateOptions;
          userContext?: UserContext;
        };

        if (!caseId) {
          throw new McpError(ErrorCode.InvalidParams, "caseId is required");
        }

        const denialCase = store.getCase(caseId);
        if (!denialCase) {
          throw new McpError(
            ErrorCode.InvalidParams,
            `Case not found: ${caseId}. Save it first using appeal.generate with storeCaseForLookup=true.`
          );
        }

        const letter = await generateAppealLetter(
          store,
          denialCase,
          options ?? {},
          userContext ?? {}
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(letter, null, 2),
            },
          ],
        };
      }

      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
  } catch (err) {
    if (err instanceof McpError) throw err;
    log("error", `Tool ${name} failed`, err);
    throw new McpError(
      ErrorCode.InternalError,
      err instanceof Error ? err.message : String(err)
    );
  }
});

// ─── Start Server ─────────────────────────────────────────────────────────────

async function main() {
  log("info", "Starting appeal-writer-mcp", {
    storagePath: config.storagePath,
    useEmbeddings: config.useEmbeddings,
    openaiModel: config.openaiApiKey ? config.openaiModel : "disabled",
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("info", "appeal-writer-mcp running on stdio");
}

main().catch((err) => {
  log("error", "Fatal error", err);
  process.exit(1);
});

// Graceful shutdown
process.on("SIGINT", () => {
  store.close();
  process.exit(0);
});
process.on("SIGTERM", () => {
  store.close();
  process.exit(0);
});
