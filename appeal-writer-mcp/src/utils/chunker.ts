/**
 * Deterministic text chunker with character-level overlap.
 * Same input always produces the same chunks.
 */

export interface TextChunk {
  index: number;
  text: string;
  start: number; // char offset in original text
  end: number;
}

/**
 * Split text into overlapping chunks by character count.
 * Tries to break at sentence/paragraph boundaries within a tolerance window.
 */
export function chunkText(
  text: string,
  chunkSize = 900,
  overlap = 150
): TextChunk[] {
  if (!text || text.trim().length === 0) return [];

  const chunks: TextChunk[] = [];
  let pos = 0;
  let index = 0;

  while (pos < text.length) {
    const end = Math.min(pos + chunkSize, text.length);
    let splitAt = end;

    // Try to find a natural break (paragraph > sentence > space) within tolerance
    if (end < text.length) {
      const searchWindow = text.slice(Math.max(end - 200, pos), end);
      const paraBreak = searchWindow.lastIndexOf("\n\n");
      const sentenceBreak = searchWindow.search(/[.!?]\s+[A-Z]/);
      const spaceBreak = searchWindow.lastIndexOf(" ");

      const base = Math.max(end - 200, pos);
      if (paraBreak !== -1) {
        splitAt = base + paraBreak + 2;
      } else if (sentenceBreak !== -1) {
        splitAt = base + sentenceBreak + 1;
      } else if (spaceBreak !== -1) {
        splitAt = base + spaceBreak + 1;
      }

      // Ensure minimum chunk size
      if (splitAt <= pos + Math.floor(chunkSize * 0.4)) {
        splitAt = end;
      }
    }

    const chunkText = text.slice(pos, splitAt).trim();
    if (chunkText.length > 0) {
      chunks.push({ index, text: chunkText, start: pos, end: splitAt });
      index++;
    }

    // Advance with overlap
    pos = Math.max(splitAt - overlap, pos + 1);
    if (pos >= text.length) break;
  }

  return chunks;
}

/** Build a line index for converting char offsets to line numbers. */
export interface LineEntry {
  line: number;
  start: number;
  end: number;
}

export function buildLineIndex(text: string): LineEntry[] {
  const index: LineEntry[] = [];
  let lineNum = 1;
  let lineStart = 0;

  for (let i = 0; i <= text.length; i++) {
    if (i === text.length || text[i] === "\n") {
      index.push({ line: lineNum, start: lineStart, end: i });
      lineNum++;
      lineStart = i + 1;
    }
  }

  return index;
}
