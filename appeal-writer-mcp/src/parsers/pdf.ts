import { log } from "../config";

/**
 * PDF text extractor using pdf-parse.
 * If the PDF is scanned (image-only) and OCR is not enabled,
 * returns the best available text and flags the warning.
 */
export async function extractPdf(
  buffer: Buffer,
  enableOcr = false
): Promise<{ text: string; warnings: string[] }> {
  const warnings: string[] = [];

  try {
    // Dynamic import to avoid breaking if library isn't installed
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pdfParse = require("pdf-parse") as (
      buf: Buffer,
      opts?: Record<string, unknown>
    ) => Promise<{ text: string; numpages: number }>;

    const result = await pdfParse(buffer, { max: 0 });
    let text = result.text ?? "";

    // Heuristic: if text is very short relative to pages, likely scanned
    const avgCharsPerPage = text.length / Math.max(result.numpages, 1);
    if (avgCharsPerPage < 80) {
      if (enableOcr) {
        warnings.push(
          "PDF appears to be scanned. OCR is enabled but not implemented in baseline — returning partial text."
        );
      } else {
        warnings.push(
          "PDF appears to be scanned (image-only). Enable OCR (ENABLE_OCR_DEFAULT=true or enableOcr option) for full extraction. Returning partial text."
        );
      }
    }

    text = text.replace(/\r\n/g, "\n").replace(/\n{4,}/g, "\n\n\n").trim();
    return { text, warnings };
  } catch (err) {
    log("error", "PDF parsing failed", err);
    warnings.push(
      `PDF parsing failed: ${err instanceof Error ? err.message : String(err)}`
    );
    return { text: "", warnings };
  }
}
