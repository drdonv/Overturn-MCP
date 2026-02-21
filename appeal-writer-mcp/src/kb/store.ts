import fs from "fs";
import path from "path";
import { log } from "../config";
import {
  ChunkRecord,
  DocRecord,
  KnowledgeDoc,
  RetrievedChunk,
  DenialCase,
} from "../types";
import { TFIDFVector, computeIDF, scoreQuery } from "./tfidf";
import { denseCosineSimilarity, EmbeddingVector } from "./embeddings";

// Lazy-load better-sqlite3 so tests without it can still import types
type DB = import("better-sqlite3").Database;

export class KBStore {
  private db!: DB;
  private initialized = false;
  private storagePath: string;

  constructor(storagePath: string) {
    this.storagePath = storagePath;
  }

  /** Initialize the SQLite database. Call before any other method. */
  init(): void {
    if (this.initialized) return;

    fs.mkdirSync(this.storagePath, { recursive: true });

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require("better-sqlite3") as new (
      path: string,
      opts?: { verbose?: (msg: string) => void }
    ) => DB;

    this.db = new Database(path.join(this.storagePath, "appeal-writer.db"));

    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA foreign_keys=ON;

      CREATE TABLE IF NOT EXISTS docs (
        docId     TEXT PRIMARY KEY,
        filename  TEXT NOT NULL,
        mimeType  TEXT NOT NULL,
        text      TEXT NOT NULL,
        payerName TEXT,
        docType   TEXT NOT NULL,
        tagsJson  TEXT NOT NULL DEFAULT '[]',
        createdAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS chunks (
        chunkId    TEXT PRIMARY KEY,
        docId      TEXT NOT NULL REFERENCES docs(docId) ON DELETE CASCADE,
        chunkIndex INTEGER NOT NULL,
        text       TEXT NOT NULL,
        vectorJson TEXT NOT NULL DEFAULT '{}'
      );

      CREATE INDEX IF NOT EXISTS idx_chunks_docId ON chunks(docId);
      CREATE INDEX IF NOT EXISTS idx_docs_payer ON docs(payerName);
      CREATE INDEX IF NOT EXISTS idx_docs_type  ON docs(docType);

      CREATE TABLE IF NOT EXISTS cases (
        caseId    TEXT PRIMARY KEY,
        dataJson  TEXT NOT NULL,
        createdAt TEXT NOT NULL
      );
    `);

    this.initialized = true;
    log("info", "KBStore initialized", { path: this.storagePath });
  }

  // ─── Document Operations ─────────────────────────────────────────────────

  upsertDoc(doc: KnowledgeDoc, chunks: ChunkRecord[]): void {
    const upsertDocStmt = this.db.prepare(`
      INSERT INTO docs (docId, filename, mimeType, text, payerName, docType, tagsJson, createdAt)
      VALUES (@docId, @filename, @mimeType, @text, @payerName, @docType, @tagsJson, @createdAt)
      ON CONFLICT(docId) DO UPDATE SET
        filename=excluded.filename, mimeType=excluded.mimeType,
        text=excluded.text, payerName=excluded.payerName,
        docType=excluded.docType, tagsJson=excluded.tagsJson,
        createdAt=excluded.createdAt
    `);

    const deleteChunksStmt = this.db.prepare(
      "DELETE FROM chunks WHERE docId = ?"
    );
    const insertChunkStmt = this.db.prepare(`
      INSERT INTO chunks (chunkId, docId, chunkIndex, text, vectorJson)
      VALUES (@chunkId, @docId, @chunkIndex, @text, @vectorJson)
    `);

    const run = this.db.transaction(() => {
      upsertDocStmt.run({
        docId: doc.docId,
        filename: doc.filename,
        mimeType: doc.mimeType,
        text: doc.text,
        payerName: doc.meta.payerName ?? null,
        docType: doc.meta.docType,
        tagsJson: JSON.stringify(doc.meta.tags ?? []),
        createdAt: doc.meta.createdAt ?? new Date().toISOString(),
      });
      deleteChunksStmt.run(doc.docId);
      for (const chunk of chunks) {
        insertChunkStmt.run(chunk);
      }
    });

    run();
  }

  getDoc(docId: string): DocRecord | null {
    return (
      (this.db
        .prepare("SELECT * FROM docs WHERE docId = ?")
        .get(docId) as DocRecord | undefined) ?? null
    );
  }

  // ─── Retrieval ───────────────────────────────────────────────────────────

  /**
   * Retrieve top-K chunks by TF-IDF cosine similarity or dense embedding.
   * Filters by payerName and/or docType when provided.
   */
  search(
    query: string,
    filters: {
      payerName?: string;
      docType?: string;
      tags?: string[];
    },
    topK = 8
  ): RetrievedChunk[] {
    // Build WHERE clause for SQL pre-filtering
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters.payerName) {
      conditions.push("(d.payerName IS NULL OR d.payerName = ?)");
      params.push(filters.payerName);
    }
    if (filters.docType) {
      conditions.push("d.docType = ?");
      params.push(filters.docType);
    }

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const rows = this.db
      .prepare(
        `SELECT c.chunkId, c.docId, c.chunkIndex, c.text, c.vectorJson,
                d.payerName, d.docType, d.tagsJson, d.createdAt
         FROM chunks c
         JOIN docs d ON d.docId = c.docId
         ${where}`
      )
      .all(...params) as Array<{
      chunkId: string;
      docId: string;
      chunkIndex: number;
      text: string;
      vectorJson: string;
      payerName: string | null;
      docType: string;
      tagsJson: string;
      createdAt: string;
    }>;

    if (rows.length === 0) return [];

    // Build IDF from all loaded chunks
    const allVectors: TFIDFVector[] = rows.map((r) => {
      try {
        return JSON.parse(r.vectorJson) as TFIDFVector;
      } catch {
        return {};
      }
    });
    const idf = computeIDF(allVectors);

    // Score each chunk
    const scored = rows.map((row, i) => {
      const storedVector = allVectors[i];
      let score = scoreQuery(query, storedVector, idf);

      // Tag filter boost (soft: not exclusionary unless tags provided)
      if (filters.tags && filters.tags.length > 0) {
        try {
          const docTags: string[] = JSON.parse(row.tagsJson);
          const matches = filters.tags.filter((t) => docTags.includes(t)).length;
          if (matches > 0) score *= 1 + matches * 0.1;
        } catch {
          // ignore
        }
      }

      return { row, score };
    });

    // Sort descending, take top-K
    scored.sort((a, b) => b.score - a.score);
    const topRows = scored.slice(0, topK);

    return topRows.map(({ row, score }) => {
      const tags: string[] = (() => {
        try {
          return JSON.parse(row.tagsJson);
        } catch {
          return [];
        }
      })();

      return {
        chunkId: row.chunkId,
        docId: row.docId,
        text: row.text,
        score,
        spans: [{ start: 0, end: row.text.length }],
        meta: {
          payerName: row.payerName ?? undefined,
          docType: row.docType as RetrievedChunk["meta"]["docType"],
          tags,
          createdAt: row.createdAt,
        },
      };
    });
  }

  /** Update vector for a chunk (dense embedding replaces TF vector). */
  updateChunkVector(chunkId: string, vector: TFIDFVector | EmbeddingVector): void {
    this.db
      .prepare("UPDATE chunks SET vectorJson = ? WHERE chunkId = ?")
      .run(JSON.stringify(vector), chunkId);
  }

  // ─── Case Registry ───────────────────────────────────────────────────────

  saveCase(denialCase: DenialCase): void {
    this.db
      .prepare(
        `INSERT INTO cases (caseId, dataJson, createdAt)
         VALUES (?, ?, ?)
         ON CONFLICT(caseId) DO UPDATE SET dataJson=excluded.dataJson, createdAt=excluded.createdAt`
      )
      .run(denialCase.caseId, JSON.stringify(denialCase), new Date().toISOString());
  }

  getCase(caseId: string): DenialCase | null {
    const row = this.db
      .prepare("SELECT dataJson FROM cases WHERE caseId = ?")
      .get(caseId) as { dataJson: string } | undefined;
    if (!row) return null;
    try {
      return JSON.parse(row.dataJson) as DenialCase;
    } catch {
      return null;
    }
  }

  // ─── Stats ───────────────────────────────────────────────────────────────

  stats(): { docs: number; chunks: number; cases: number } {
    const docs = (
      this.db.prepare("SELECT COUNT(*) as n FROM docs").get() as { n: number }
    ).n;
    const chunks = (
      this.db.prepare("SELECT COUNT(*) as n FROM chunks").get() as { n: number }
    ).n;
    const cases = (
      this.db.prepare("SELECT COUNT(*) as n FROM cases").get() as { n: number }
    ).n;
    return { docs, chunks, cases };
  }

  /** Close the database connection. */
  close(): void {
    if (this.initialized) {
      this.db.close();
      this.initialized = false;
    }
  }
}
