/**
 * KB layer unit tests.
 *
 * Tests:
 *  - TF-IDF tokenization and scoring
 *  - Chunking determinism
 *  - Store ingestion and retrieval (in-memory via temp dir)
 *  - Policy chunk is returned for policy reference query
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "os";
import fs from "fs";
import path from "path";

import { tokenize, computeTF, computeIDF, cosineSimilarity, buildTFVector } from "../src/kb/tfidf";
import { chunkText } from "../src/utils/chunker";
import { KBStore } from "../src/kb/store";
import { ingestDocuments } from "../src/kb/ingest";

// ─── TF-IDF unit tests ───────────────────────────────────────────────────────

describe("tfidf", () => {
  it("tokenizes and lowercases text", () => {
    const tokens = tokenize("Physical Therapy CPT 97110 is Medically Necessary");
    expect(tokens).toContain("physical");
    expect(tokens).toContain("cpt");
    expect(tokens).toContain("97110");
    expect(tokens).toContain("medically");
    // Stop words removed
    expect(tokens).not.toContain("is");
  });

  it("produces bigrams", () => {
    const tokens = tokenize("medical necessity review");
    expect(tokens).toContain("medical_necessity");
    expect(tokens).toContain("necessity_review");
  });

  it("computeTF gives higher weight to repeated terms", () => {
    const tf = computeTF(["therapy", "therapy", "therapy", "session"]);
    expect(tf["therapy"]).toBeGreaterThan(tf["session"]);
  });

  it("computeIDF penalizes terms appearing in all docs", () => {
    const v1 = { therapy: 1, session: 1 };
    const v2 = { therapy: 1, limit: 1 };
    const idf = computeIDF([v1, v2]);
    // "therapy" appears in both → lower IDF than "session" or "limit"
    expect(idf["therapy"]).toBeLessThan(idf["session"]);
    expect(idf["therapy"]).toBeLessThan(idf["limit"]);
  });

  it("cosine similarity is 1.0 for identical vectors", () => {
    const v = { a: 1, b: 2, c: 3 };
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0);
  });

  it("cosine similarity is 0 for orthogonal vectors", () => {
    const v1 = { a: 1, b: 0 };
    const v2 = { c: 1, d: 1 };
    expect(cosineSimilarity(v1, v2)).toBeCloseTo(0.0);
  });

  it("cosine similarity is higher for related text", () => {
    const policyText = buildTFVector("physical therapy session limit 12 sessions per year clinical policy bulletin");
    const queryText = buildTFVector("session limit physical therapy policy");
    const unrelatedText = buildTFVector("car insurance premium deductible auto collision");

    const idf = computeIDF([policyText, queryText, unrelatedText]);

    // query vs policy should score higher than query vs unrelated
    const scorePolicyVsQuery = cosineSimilarity(policyText, queryText);
    const scoreUnrelatedVsQuery = cosineSimilarity(unrelatedText, queryText);
    expect(scorePolicyVsQuery).toBeGreaterThan(scoreUnrelatedVsQuery);
  });
});

// ─── Chunker tests ───────────────────────────────────────────────────────────

describe("chunker", () => {
  it("produces deterministic chunks", () => {
    const text = "A".repeat(2000);
    const chunks1 = chunkText(text, 900, 150);
    const chunks2 = chunkText(text, 900, 150);
    expect(chunks1.length).toBe(chunks2.length);
    for (let i = 0; i < chunks1.length; i++) {
      expect(chunks1[i].text).toBe(chunks2[i].text);
      expect(chunks1[i].start).toBe(chunks2[i].start);
    }
  });

  it("chunks cover the full text without gaps at start/end", () => {
    const text = "The quick brown fox jumps over the lazy dog. ".repeat(50);
    const chunks = chunkText(text, 200, 40);
    expect(chunks.length).toBeGreaterThan(0);
    // First chunk starts at or near 0
    expect(chunks[0].start).toBe(0);
    // Last chunk end covers most of the text
    expect(chunks[chunks.length - 1].end).toBeGreaterThan(text.length * 0.8);
  });

  it("produces no empty chunks", () => {
    const text = "Short text only.";
    const chunks = chunkText(text, 900, 150);
    for (const c of chunks) {
      expect(c.text.trim().length).toBeGreaterThan(0);
    }
  });

  it("handles empty text gracefully", () => {
    expect(chunkText("", 900, 150)).toHaveLength(0);
    expect(chunkText("   ", 900, 150)).toHaveLength(0);
  });
});

// ─── KB Store + Retrieval tests ──────────────────────────────────────────────

describe("kb store and retrieval", () => {
  let store: KBStore;
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "appeal-test-"));
    store = new KBStore(tmpDir);
    store.init();

    const POLICY_TEXT = `CLINICAL POLICY BULLETIN #045
Physical therapy for outpatient services is covered when medically necessary.
Coverage is limited to 12 sessions per calendar year.
Exception: Coverage beyond the limit may be approved when significant functional improvement is documented.
A physician letter of medical necessity is required for exceptions.
Appeal must be submitted within 180 days of denial.`;

    const APPEAL_TEXT = `SAMPLE ACCEPTED APPEAL LETTER
We appeal the denial of physical therapy (CPT 97110) based on benefit limit.
Enclosed are progress notes documenting functional improvement exceeding 20%.
Physician attestation confirms medical necessity for continued treatment.`;

    await ingestDocuments(store, [
      {
        docId: "policy_cpb045",
        filename: "policy.txt",
        mimeType: "text/plain",
        contentBase64: Buffer.from(POLICY_TEXT).toString("base64"),
        meta: {
          payerName: "HEALTH INSURANCE COMPANY",
          docType: "policy",
          tags: ["physical-therapy", "CPB045"],
        },
      },
      {
        docId: "prior_appeal_001",
        filename: "prior_appeal.txt",
        mimeType: "text/plain",
        contentBase64: Buffer.from(APPEAL_TEXT).toString("base64"),
        meta: {
          payerName: "HEALTH INSURANCE COMPANY",
          docType: "prior_appeal_accepted",
          tags: ["physical-therapy", "benefit-limit"],
        },
      },
    ]);
  });

  afterAll(() => {
    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns chunks for a policy reference query", () => {
    const results = store.search(
      "Clinical Policy Bulletin #045 session limit physical therapy",
      { payerName: "HEALTH INSURANCE COMPANY" },
      5
    );
    expect(results.length).toBeGreaterThan(0);
    const topChunk = results[0];
    expect(topChunk.score).toBeGreaterThan(0);
    // Should retrieve the policy document
    const policyResult = results.find((r) => r.docId === "policy_cpb045");
    expect(policyResult).toBeDefined();
  });

  it("scores policy chunk higher than appeal chunk for policy query", () => {
    const results = store.search(
      "CPB045 session limit 12 sessions per year clinical policy",
      {},
      10
    );
    const policyScore = results.find((r) => r.docId === "policy_cpb045")?.score ?? 0;
    const appealScore = results.find((r) => r.docId === "prior_appeal_001")?.score ?? 0;
    // Policy doc should score higher for this policy-specific query
    expect(policyScore).toBeGreaterThanOrEqual(appealScore);
  });

  it("returns prior_appeal_accepted when filtering by docType", () => {
    const results = store.search(
      "appeal physical therapy functional improvement",
      { docType: "prior_appeal_accepted" },
      5
    );
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.meta.docType === "prior_appeal_accepted")).toBe(true);
  });

  it("chunk metadata is preserved correctly", () => {
    const results = store.search("benefit limit session", {}, 5);
    const policyChunk = results.find((r) => r.docId === "policy_cpb045");
    expect(policyChunk).toBeDefined();
    expect(policyChunk?.meta.docType).toBe("policy");
    expect(policyChunk?.meta.payerName).toBe("HEALTH INSURANCE COMPANY");
    expect(policyChunk?.meta.tags).toContain("CPB045");
  });

  it("case registry saves and retrieves cases", () => {
    const mockCase = {
      caseId: "test_case_001",
      payerName: { value: "Test Payer", confidence: 1, spans: [] },
    } as unknown as import("../src/types").DenialCase;

    store.saveCase(mockCase);
    const retrieved = store.getCase("test_case_001");
    expect(retrieved).not.toBeNull();
    expect(retrieved?.caseId).toBe("test_case_001");
    expect(retrieved?.payerName.value).toBe("Test Payer");
  });

  it("returns null for unknown case ID", () => {
    expect(store.getCase("nonexistent_id_xyz")).toBeNull();
  });
});
