import { createHash } from "crypto";

/** Deterministic SHA-256 hash truncated to 16 hex chars. */
export function shortHash(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

/** Stable ID from multiple string parts. */
export function stableId(...parts: string[]): string {
  return shortHash(parts.join("|"));
}

/** Unique letter ID with timestamp component (still deterministic per caseId+createdAt). */
export function letterId(caseId: string, createdAt: string): string {
  return `ltr_${shortHash(caseId + createdAt)}`;
}

/** Chunk ID from docId + chunk index. */
export function chunkId(docId: string, index: number): string {
  return `chk_${shortHash(docId + String(index))}`;
}
