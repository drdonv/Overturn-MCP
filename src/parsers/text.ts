/** Plain-text extractor — identity transform with normalization. */
export async function extractText(input: string | Buffer): Promise<string> {
  const raw = Buffer.isBuffer(input) ? input.toString("utf-8") : input;
  // Normalize CRLF and collapse more than 3 consecutive blank lines
  return raw.replace(/\r\n/g, "\n").replace(/\n{4,}/g, "\n\n\n").trim();
}
