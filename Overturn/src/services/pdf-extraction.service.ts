import fs from "node:fs/promises";
import path from "node:path";

import { PDFParse } from "pdf-parse";

import { getErrorMessage } from "../utils/errors.js";

export class PdfExtractionService {
  async extractClaimData(filePath: string) {
    const resolvedPath = path.resolve(filePath);
    const fileBuffer = await fs.readFile(resolvedPath);
    const parser = new PDFParse({ data: fileBuffer });
    try {
      const textResult = await parser.getText();
      let info: Record<string, unknown> = {};
      let fingerprints: Array<string | null> = [];
      let infoParseError: string | undefined;

      try {
        const infoResult = await parser.getInfo();
        info = (infoResult.info ?? {}) as Record<string, unknown>;
        fingerprints = infoResult.fingerprints ?? [];
      } catch (err) {
        infoParseError = getErrorMessage(err);
      }

      return {
        file_path: resolvedPath,
        raw_text: (textResult.text ?? "").trim(),
        metadata: {
          pages: textResult.total ?? 0,
          info,
          fingerprints,
          info_parse_error: infoParseError,
        },
      };
    } finally {
      await parser.destroy();
    }
  }
}
