import { randomUUID } from "crypto";
import { config, log } from "../config";
import { ChunkRecord, IngestOptions, KnowledgeDoc } from "../types";
import { extractText } from "../parsers/text";
import { extractPdf } from "../parsers/pdf";
import { extractDocx } from "../parsers/docx";
import { chunkText } from "../utils/chunker";
import { stableId, chunkId } from "../utils/hash";
import { buildTFVector } from "./tfidf";
import { embedText } from "./embeddings";
import { KBStore } from "./store";

export interface IngestResult {
  docId: string;
  chunks: number;
  warnings: string[];
}

export interface IngestInput {
  docId?: string;
  filename: string;
  mimeType: string;
  contentBase64: string;
  meta: {
    payerName?: string;
    docType: KnowledgeDoc["meta"]["docType"];
    tags?: string[];
    createdAt?: string;
  };
}

/** Parse file buffer into plain text based on MIME type. */
async function parseBuffer(
  buffer: Buffer,
  mimeType: string,
  filename: string,
  enableOcr: boolean
): Promise<{ text: string; warnings: string[] }> {
  const mt = mimeType.toLowerCase();
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";

  if (mt.includes("pdf") || ext === "pdf") {
    return extractPdf(buffer, enableOcr);
  }
  if (
    mt.includes("officedocument.wordprocessing") ||
    mt.includes("msword") ||
    ext === "docx" ||
    ext === "doc"
  ) {
    return extractDocx(buffer);
  }
  // Default: plain text
  const text = await extractText(buffer);
  return { text, warnings: [] };
}

/** Ingest one or more documents into the KB store. */
export async function ingestDocuments(
  store: KBStore,
  inputs: IngestInput[],
  options: IngestOptions = {}
): Promise<IngestResult[]> {
  const chunkSize = options.chunkSize ?? 900;
  const chunkOverlap = options.chunkOverlap ?? 150;
  const maxChars = options.maxChars ?? 800_000;
  const maxBytes = config.maxFileMb * 1024 * 1024;
  const results: IngestResult[] = [];

  for (const input of inputs) {
    const warnings: string[] = [];

    // Decode content
    let buffer: Buffer;
    try {
      buffer = Buffer.from(input.contentBase64, "base64");
    } catch {
      warnings.push(`Failed to decode base64 for ${input.filename}`);
      results.push({ docId: input.docId ?? "unknown", chunks: 0, warnings });
      continue;
    }

    if (buffer.length > maxBytes) {
      warnings.push(
        `File ${input.filename} exceeds MAX_FILE_MB=${config.maxFileMb} — skipped`
      );
      results.push({ docId: input.docId ?? "unknown", chunks: 0, warnings });
      continue;
    }

    // Parse to text
    const { text: rawText, warnings: parseWarnings } = await parseBuffer(
      buffer,
      input.mimeType,
      input.filename,
      config.enableOcrDefault
    );
    warnings.push(...parseWarnings);

    if (!rawText || rawText.trim().length === 0) {
      warnings.push(`No text extracted from ${input.filename}`);
      results.push({ docId: input.docId ?? "unknown", chunks: 0, warnings });
      continue;
    }

    const truncatedText =
      rawText.length > maxChars ? rawText.slice(0, maxChars) : rawText;
    if (rawText.length > maxChars) {
      warnings.push(
        `Text truncated to ${maxChars} chars (original: ${rawText.length})`
      );
    }

    // Build stable docId from content + filename
    const docId =
      input.docId?.trim() ||
      stableId(input.filename, truncatedText.slice(0, 200));

    const doc: KnowledgeDoc = {
      docId,
      filename: input.filename,
      mimeType: input.mimeType,
      text: truncatedText,
      meta: {
        payerName: input.meta.payerName,
        docType: input.meta.docType,
        tags: input.meta.tags ?? [],
        createdAt: input.meta.createdAt ?? new Date().toISOString(),
      },
    };

    // Chunk text
    const textChunks = chunkText(truncatedText, chunkSize, chunkOverlap);
    log("debug", `Chunked ${input.filename}`, {
      chunks: textChunks.length,
      chars: truncatedText.length,
    });

    // Build chunk records with vectors
    const chunkRecords: ChunkRecord[] = [];
    for (const tc of textChunks) {
      const cid = chunkId(docId, tc.index);

      // Try OpenAI embedding, fall back to TF-IDF
      let vectorJson: string;
      const embedding = await embedText(tc.text);
      if (embedding) {
        vectorJson = JSON.stringify(embedding);
      } else {
        vectorJson = JSON.stringify(buildTFVector(tc.text));
      }

      chunkRecords.push({
        chunkId: cid,
        docId,
        chunkIndex: tc.index,
        text: tc.text,
        vectorJson,
      });
    }

    // Persist to SQLite
    store.upsertDoc(doc, chunkRecords);

    results.push({ docId, chunks: chunkRecords.length, warnings });
    log("info", `Ingested document`, { docId, chunks: chunkRecords.length });
  }

  return results;
}
