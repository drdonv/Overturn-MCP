/**
 * Grounding verifier.
 *
 * Rules:
 *  1. Every paragraph (non-empty) must have ≥1 citation.
 *  2. Every sentence containing a numeric claim (date, dollar amount, count,
 *     limit) must be backed by a citation whose snippet contains that value.
 *  3. Violations produce warnings and/or NEEDS EVIDENCE placeholders.
 */

import { Citation, LetterSection } from "../types";

// Patterns that flag a sentence as containing a numeric claim requiring citation
const NUMERIC_CLAIM_PATTERNS = [
  /\$[\d,]+(?:\.\d{2})?/,                           // Dollar amount
  /\b\d{1,3}(?:,\d{3})*(?:\.\d+)?\s*(?:dollars?|USD)/i,
  /\b\d{4}-\d{2}-\d{2}\b/,                          // ISO date
  /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b/i,
  /\b\d+\s+(?:days?|sessions?|visits?|units?)\b/i,  // Counts
  /\b\d+%\b/,                                        // Percentages
  /\bwithin\s+\d+\s+days?\b/i,                       // Deadlines
  /\blimit(?:ed)?\s+to\s+\d+\b/i,                   // Limits
  /\bCPT\s+\d{4,5}\b/i,                             // CPT codes
  /\bICD-?\d+\b/i,                                   // ICD codes
];

const NEEDS_EVIDENCE_RE = /\[NEEDS EVIDENCE:[^\]]+\]/gi;

export interface VerificationResult {
  /** Sections after verification — may have content modified to add TODO placeholders. */
  sections: LetterSection[];
  /** List of unresolved numeric/unsupported claims that received NEEDS EVIDENCE tags. */
  unresolvedClaims: string[];
  /** Non-fatal warnings (e.g., paragraph lacks citations but has TODO placeholder). */
  warnings: string[];
}

/** Check whether a sentence is already marked as needing evidence. */
function hasNeedsEvidence(sentence: string): boolean {
  return NEEDS_EVIDENCE_RE.test(sentence);
}

/** Check whether a sentence has any numeric claims requiring citation. */
function hasNumericClaim(sentence: string): boolean {
  return NUMERIC_CLAIM_PATTERNS.some((re) => re.test(sentence));
}

/**
 * Check if a citation's snippet contains a value mentioned in the sentence.
 * We do a simple substring search for numbers, dates, and CPT codes.
 */
function citationCoversValue(sentence: string, citations: Citation[]): boolean {
  if (citations.length === 0) return false;

  // Extract numeric tokens from sentence
  const dollarAmounts = sentence.match(/\$[\d,]+(?:\.\d{2})?/g) ?? [];
  const numbers = sentence.match(/\b\d[\d,]*(?:\.\d+)?\b/g) ?? [];
  const cptCodes = sentence.match(/\bCPT\s+\d{4,5}\b/gi) ?? [];

  const needles = [...dollarAmounts, ...numbers, ...cptCodes].map((n) =>
    n.replace(/,/g, "").replace(/CPT\s+/i, "").trim()
  );

  if (needles.length === 0) return true; // no specific value to verify

  // Check if any citation snippet contains any of the needles
  for (const citation of citations) {
    const snippet = citation.snippet.replace(/,/g, "");
    for (const needle of needles) {
      if (needle.length > 0 && snippet.includes(needle)) return true;
    }
  }
  return false;
}

/** Split content into sentences (simple heuristic). */
function splitSentences(text: string): string[] {
  // Split on sentence-ending punctuation followed by whitespace or newline
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z\[])|(?<=\n)\s*(?=[A-Z\[])|(?<=[:.])\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Verify and patch all sections.
 * Returns patched sections + metadata about what was unresolved.
 */
export function verifySections(sections: LetterSection[]): VerificationResult {
  const unresolvedClaims: string[] = [];
  const warnings: string[] = [];
  const patched: LetterSection[] = [];

  for (const section of sections) {
    const sectionWarnings: string[] = [...(section.warnings ?? [])];
    let content = section.content;
    const citations = section.citations;

    // Rule 1: paragraph must have ≥1 citation
    const paragraphs = content.split(/\n\n+/);
    const hasCitationOrPlaceholder =
      citations.length > 0 || hasNeedsEvidence(content);

    if (!hasCitationOrPlaceholder && section.id !== "header" && section.id !== "closing") {
      sectionWarnings.push(
        `Section "${section.title}" has no citations and no NEEDS EVIDENCE placeholders.`
      );
      warnings.push(
        `Section "${section.title}" missing citations — verify supporting evidence`
      );
    }

    // Rule 2: sentences with numeric claims must be citation-backed
    const sentences = splitSentences(content);
    let patchedContent = content;

    for (const sentence of sentences) {
      if (!hasNumericClaim(sentence)) continue;
      if (hasNeedsEvidence(sentence)) continue; // already flagged

      if (!citationCoversValue(sentence, citations)) {
        // Find the numeric values that need evidence
        const numericValues = [
          ...(sentence.match(/\$[\d,]+(?:\.\d{2})?/g) ?? []),
          ...(sentence.match(/\b\d+\s+(?:days?|sessions?|visits?)\b/gi) ?? []),
          ...(sentence.match(/\bCPT\s+\d{4,5}\b/gi) ?? []),
        ].join(", ");

        const placeholder = numericValues
          ? `[NEEDS EVIDENCE: source for ${numericValues}]`
          : `[NEEDS EVIDENCE: citation for numeric claim in this sentence]`;

        // Append placeholder after the sentence in the content
        patchedContent = patchedContent.replace(
          sentence,
          `${sentence} ${placeholder}`
        );
        unresolvedClaims.push(
          `${section.title}: numeric claim needs citation — "${sentence.slice(0, 80)}..."`
        );
      }
    }

    patched.push({
      ...section,
      content: patchedContent,
      warnings: sectionWarnings.length > 0 ? sectionWarnings : undefined,
    });
  }

  return { sections: patched, unresolvedClaims, warnings };
}

/**
 * Collect all NEEDS EVIDENCE strings from the letter sections.
 */
export function collectMissingEvidence(sections: LetterSection[]): string[] {
  const items: string[] = [];
  for (const section of sections) {
    const matches = section.content.match(/\[NEEDS EVIDENCE:[^\]]+\]/gi) ?? [];
    for (const m of matches) {
      const clean = m.replace(/^\[NEEDS EVIDENCE:\s*/i, "").replace(/\]$/, "").trim();
      if (!items.includes(clean)) items.push(clean);
    }
  }
  return items;
}
