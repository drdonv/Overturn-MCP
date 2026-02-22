import { DenialMapping } from "../constants/denial.js";
import { normalizeCode } from "../utils/normalization.js";

export class DenialAnalysisService {
  analyzeCodes(codes: string[]) {
    return codes.map((code) => {
      const normalizedCode = normalizeCode(code);
      const mapped = DenialMapping[normalizedCode as keyof typeof DenialMapping];

      if (!mapped) {
        return {
          input_code: code,
          normalized_code: normalizedCode,
          found: false,
          explanation:
            "Unknown code in local CARC dictionary. Use denial-knowledge-base resource for additional context.",
        };
      }

      return {
        input_code: code,
        normalized_code: normalizedCode,
        found: true,
        title: mapped.title,
        explanation: mapped.explanation,
        recommended_action: mapped.recommendedAction,
      };
    });
  }
}
