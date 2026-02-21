import { log } from "../config";

/**
 * DOCX text extractor using mammoth.
 * Preserves paragraph breaks but strips all formatting.
 */
export async function extractDocx(
  buffer: Buffer
): Promise<{ text: string; warnings: string[] }> {
  const warnings: string[] = [];

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mammoth = require("mammoth") as {
      extractRawText: (opts: { buffer: Buffer }) => Promise<{
        value: string;
        messages: Array<{ type: string; message: string }>;
      }>;
    };

    const result = await mammoth.extractRawText({ buffer });

    for (const msg of result.messages ?? []) {
      if (msg.type === "warning") {
        warnings.push(`DOCX: ${msg.message}`);
      }
    }

    const text = (result.value ?? "")
      .replace(/\r\n/g, "\n")
      .replace(/\n{4,}/g, "\n\n\n")
      .trim();

    return { text, warnings };
  } catch (err) {
    log("error", "DOCX parsing failed", err);
    warnings.push(
      `DOCX parsing failed: ${err instanceof Error ? err.message : String(err)}`
    );
    return { text: "", warnings };
  }
}
