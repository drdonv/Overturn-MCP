/**
 * Appeal generation unit tests.
 *
 * Tests:
 *  - appeal.generate produces ≥ 6 sections
 *  - Attachment checklist is populated
 *  - Each section has ≥1 citation OR a NEEDS EVIDENCE warning/placeholder
 *  - No numeric facts appear without citations ($ amounts, dates, session counts)
 *  - Missing evidence list is surfaced
 *  - Verifier correctly flags uncited numeric claims
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "os";
import fs from "fs";
import path from "path";

import { KBStore } from "../src/kb/store";
import { ingestDocuments } from "../src/kb/ingest";
import { generateAppealLetter } from "../src/appeal/generate";
import { runPlan } from "../src/appeal/plan";
import { verifySections, collectMissingEvidence } from "../src/appeal/verify";
import { DenialCase, LetterSection, Citation } from "../src/types";

// ─── Shared test fixtures ────────────────────────────────────────────────────

const SAMPLE_DENIAL_CASE: DenialCase = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "../examples/sample_denial_case.json"),
    "utf-8"
  )
);

const POLICY_TEXT = fs.readFileSync(
  path.join(__dirname, "../examples/sample_kb_policy.txt"),
  "utf-8"
);

const PRIOR_APPEAL_TEXT = fs.readFileSync(
  path.join(__dirname, "../examples/sample_prior_appeal_accepted.txt"),
  "utf-8"
);

// ─── Setup ───────────────────────────────────────────────────────────────────

let store: KBStore;
let tmpDir: string;
let generatedLetter: Awaited<ReturnType<typeof generateAppealLetter>>;

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "appeal-gen-test-"));
  store = new KBStore(tmpDir);
  store.init();

  await ingestDocuments(store, [
    {
      docId: "kb_policy_cpb045",
      filename: "policy.txt",
      mimeType: "text/plain",
      contentBase64: Buffer.from(POLICY_TEXT).toString("base64"),
      meta: {
        payerName: "HEALTH INSURANCE COMPANY",
        docType: "policy",
        tags: ["physical-therapy", "CPB045", "session-limit"],
      },
    },
    {
      docId: "kb_prior_appeal",
      filename: "prior_appeal.txt",
      mimeType: "text/plain",
      contentBase64: Buffer.from(PRIOR_APPEAL_TEXT).toString("base64"),
      meta: {
        payerName: "HEALTH INSURANCE COMPANY",
        docType: "prior_appeal_accepted",
        tags: ["physical-therapy", "benefit-limit"],
      },
    },
  ]);

  generatedLetter = await generateAppealLetter(
    store,
    SAMPLE_DENIAL_CASE,
    { tone: "professional", includeCitationsInline: true },
    { diagnosis: "Lumbar radiculopathy", requestedOutcome: "pay_claim" }
  );
}, 30000);

afterAll(() => {
  store.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── Section count ───────────────────────────────────────────────────────────

describe("appeal.generate — section count", () => {
  it("produces at least 6 sections", () => {
    expect(generatedLetter.sections.length).toBeGreaterThanOrEqual(6);
  });

  it("includes required section IDs", () => {
    const ids = generatedLetter.sections.map((s) => s.id);
    expect(ids).toContain("header");
    expect(ids).toContain("opening");
    expect(ids).toContain("denial_codes");
    expect(ids).toContain("grounds_for_appeal");
    expect(ids).toContain("attachments");
    expect(ids).toContain("closing");
  });
});

// ─── Attachment checklist ─────────────────────────────────────────────────────

describe("appeal.generate — attachment checklist", () => {
  it("is populated with at least 3 items", () => {
    expect(generatedLetter.attachmentChecklist.length).toBeGreaterThanOrEqual(3);
  });

  it("includes the letter of medical necessity", () => {
    const items = generatedLetter.attachmentChecklist.map((a) => a.item.toLowerCase());
    expect(items.some((i) => i.includes("medical necessity"))).toBe(true);
  });

  it("marks at least one item as required", () => {
    expect(generatedLetter.attachmentChecklist.some((a) => a.required)).toBe(true);
  });
});

// ─── Citation coverage ────────────────────────────────────────────────────────

describe("appeal.generate — citation coverage", () => {
  it("each section has ≥1 citation OR a NEEDS EVIDENCE placeholder", () => {
    const skippedIds = new Set(["header", "closing"]); // low-risk structural sections

    for (const section of generatedLetter.sections) {
      if (skippedIds.has(section.id)) continue;

      const hasCitation = section.citations.length > 0;
      const hasPlaceholder = /\[NEEDS EVIDENCE:/i.test(section.content);
      const hasWarning =
        (section.warnings?.some((w) => w.includes("NEEDS EVIDENCE")) ?? false) ||
        (section.warnings?.some((w) => w.includes("no KB citations")) ?? false);

      expect(
        hasCitation || hasPlaceholder || hasWarning,
        `Section "${section.title}" has no citations and no NEEDS EVIDENCE placeholder`
      ).toBe(true);
    }
  });

  it("all denial case citations reference a known docId", () => {
    const expectedDocId = SAMPLE_DENIAL_CASE.docMeta.docId;
    const denialCitedDocIds = generatedLetter.sections
      .flatMap((s) => s.citations)
      .filter((c) => c.kind === "denialCaseSpan")
      .map((c) => c.docId);

    // All denial case span citations should reference the correct doc
    if (denialCitedDocIds.length > 0) {
      expect(denialCitedDocIds.every((id) => id === expectedDocId)).toBe(true);
    }
  });

  it("KB chunk citations reference ingested documents", () => {
    const ingestedDocIds = new Set(["kb_policy_cpb045", "kb_prior_appeal"]);
    const kbCitations = generatedLetter.sections
      .flatMap((s) => s.citations)
      .filter((c) => c.kind === "kbChunk");

    for (const citation of kbCitations) {
      expect(ingestedDocIds.has(citation.docId)).toBe(true);
    }
  });
});

// ─── Numeric claim grounding ──────────────────────────────────────────────────

describe("appeal.generate — numeric claim grounding", () => {
  /**
   * For each section, ensure that sentences containing $ amounts or session
   * counts have at least one citation or a NEEDS EVIDENCE placeholder.
   */
  const DOLLAR_PATTERN = /\$[\d,]+(?:\.\d{2})?/;
  const SESSION_PATTERN = /\b\d+\s+sessions?\b/i;
  const NEEDS_EVIDENCE_PATTERN = /\[NEEDS EVIDENCE:[^\]]+\]/i;

  function sentencesContainingNumeric(text: string): string[] {
    return text
      .split(/(?<=[.!?])\s+|(?<=\n)\s*/)
      .filter((s) => DOLLAR_PATTERN.test(s) || SESSION_PATTERN.test(s));
  }

  it("dollar amounts in sections are either cited or have NEEDS EVIDENCE", () => {
    for (const section of generatedLetter.sections) {
      const numericSentences = sentencesContainingNumeric(section.content);
      for (const sentence of numericSentences) {
        const hasCitation = section.citations.length > 0;
        const hasPlaceholder = NEEDS_EVIDENCE_PATTERN.test(section.content);
        expect(
          hasCitation || hasPlaceholder,
          `Section "${section.title}" contains "${sentence.slice(0, 60)}..." with no citation or placeholder`
        ).toBe(true);
      }
    }
  });
});

// ─── Missing evidence ─────────────────────────────────────────────────────────

describe("appeal.generate — missing evidence", () => {
  it("missing evidence list is an array", () => {
    expect(Array.isArray(generatedLetter.missingEvidence)).toBe(true);
  });

  it("missing evidence items are non-empty strings", () => {
    for (const item of generatedLetter.missingEvidence) {
      expect(typeof item).toBe("string");
      expect(item.trim().length).toBeGreaterThan(0);
    }
  });
});

// ─── Action items ─────────────────────────────────────────────────────────────

describe("appeal.generate — action items", () => {
  it("has at least 3 action items", () => {
    expect(generatedLetter.actionItems.length).toBeGreaterThanOrEqual(3);
  });

  it("has at least one P0 action item (deadline or critical evidence)", () => {
    const p0Items = generatedLetter.actionItems.filter((a) => a.priority === "p0");
    expect(p0Items.length).toBeGreaterThanOrEqual(1);
  });

  it("each action item has a non-empty action and why", () => {
    for (const item of generatedLetter.actionItems) {
      expect(item.action.trim().length).toBeGreaterThan(0);
      expect(item.why.trim().length).toBeGreaterThan(0);
    }
  });
});

// ─── Full text ────────────────────────────────────────────────────────────────

describe("appeal.generate — full text", () => {
  it("fullText is non-empty", () => {
    expect(generatedLetter.fullText.trim().length).toBeGreaterThan(100);
  });

  it("fullText contains the member name from the denial case", () => {
    expect(generatedLetter.fullText).toContain(
      SAMPLE_DENIAL_CASE.memberName.value!
    );
  });

  it("fullText contains the claim number", () => {
    expect(generatedLetter.fullText).toContain(
      SAMPLE_DENIAL_CASE.claimNumber.value!
    );
  });
});

// ─── Verifier unit tests ──────────────────────────────────────────────────────

describe("verify.verifySections", () => {
  it("flags numeric claim in uncited section with NEEDS EVIDENCE", () => {
    const sections: LetterSection[] = [
      {
        id: "test_section",
        title: "Test",
        content: "Patient owes $450.00 for this service.",
        citations: [], // no citations
      },
    ];

    const result = verifySections(sections);
    const content = result.sections[0].content;
    expect(content).toMatch(/\[NEEDS EVIDENCE:/i);
    expect(result.unresolvedClaims.length).toBeGreaterThan(0);
  });

  it("does not flag numeric claim when citation is present and covers value", () => {
    const citation: Citation = {
      kind: "denialCaseSpan",
      docId: "doc_sample_denial",
      start: 820,
      end: 880,
      snippet: "The total amount you may owe the provider is: $450.00",
      label: "patientResponsibilityAmount",
    };

    const sections: LetterSection[] = [
      {
        id: "test_section",
        title: "Test",
        content: "Patient owes $450.00 for this service.",
        citations: [citation],
      },
    ];

    const result = verifySections(sections);
    // Should not add NEEDS EVIDENCE since the citation snippet contains "450.00"
    expect(result.unresolvedClaims.length).toBe(0);
  });

  it("collectMissingEvidence extracts all NEEDS EVIDENCE items", () => {
    const sections: LetterSection[] = [
      {
        id: "s1",
        title: "Section 1",
        content: "Please provide [NEEDS EVIDENCE: functional improvement documentation] before filing.",
        citations: [],
      },
      {
        id: "s2",
        title: "Section 2",
        content: "Session count: [NEEDS EVIDENCE: payer session count record]. Also [NEEDS EVIDENCE: functional improvement documentation].",
        citations: [],
      },
    ];

    const missing = collectMissingEvidence(sections);
    // Deduplicates identical strings
    const unique = [...new Set(missing)];
    expect(unique.length).toBe(2);
    expect(unique.some((m) => m.includes("functional improvement"))).toBe(true);
    expect(unique.some((m) => m.includes("session count record"))).toBe(true);
  });
});

// ─── Argument plan tests ──────────────────────────────────────────────────────

describe("appeal.plan", () => {
  it("generates a plan with primary category and thesis", () => {
    const result = runPlan(store, SAMPLE_DENIAL_CASE, {
      diagnosis: "Lumbar radiculopathy",
      requestedOutcome: "pay_claim",
    });

    expect(result.plan.primaryDenialCategory).toBe("benefit_limit");
    expect(result.plan.thesis.length).toBeGreaterThan(20);
    expect(result.plan.arguments.length).toBeGreaterThan(0);
  });

  it("retrieves KB context from the store", () => {
    const result = runPlan(store, SAMPLE_DENIAL_CASE, {});
    // Should retrieve some chunks since we ingested policy and prior appeal
    expect(result.retrievedContext.length).toBeGreaterThan(0);
  });

  it("each argument has requiredEvidence and retrievalQueries", () => {
    const result = runPlan(store, SAMPLE_DENIAL_CASE, {});
    for (const arg of result.plan.arguments) {
      expect(Array.isArray(arg.requiredEvidence)).toBe(true);
      expect(Array.isArray(arg.retrievalQueries)).toBe(true);
      expect(arg.requiredEvidence.length).toBeGreaterThan(0);
    }
  });

  it("surfaces missing evidence for clinical notes when none ingested separately", () => {
    // Create a fresh store with no clinical docs
    const freshTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "appeal-plan-test-"));
    const freshStore = new KBStore(freshTmpDir);
    freshStore.init();

    try {
      const result = runPlan(freshStore, SAMPLE_DENIAL_CASE, {});
      expect(result.missingEvidence.length).toBeGreaterThan(0);
      // Should flag clinical notes missing
      const hasClinicalNote = result.missingEvidence.some((m) =>
        m.toLowerCase().includes("clinical")
      );
      expect(hasClinicalNote).toBe(true);
    } finally {
      freshStore.close();
      fs.rmSync(freshTmpDir, { recursive: true, force: true });
    }
  });
});
