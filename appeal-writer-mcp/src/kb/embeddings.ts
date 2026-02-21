import { config, log } from "../config";

export type EmbeddingVector = number[];

/**
 * Attempt to embed text using OpenAI text-embedding-3-small.
 * Returns null if API key is not available or call fails.
 */
export async function embedText(text: string): Promise<EmbeddingVector | null> {
  if (!config.openaiApiKey || !config.useEmbeddings) return null;

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const OpenAI = require("openai") as {
      default: new (opts: { apiKey: string }) => {
        embeddings: {
          create: (opts: {
            model: string;
            input: string;
          }) => Promise<{ data: Array<{ embedding: number[] }> }>;
        };
      };
    };
    const client = new OpenAI.default({ apiKey: config.openaiApiKey });
    const res = await client.embeddings.create({
      model: config.openaiEmbeddingModel,
      input: text.slice(0, 8000), // API limit guard
    });
    return res.data[0]?.embedding ?? null;
  } catch (err) {
    log("warn", "OpenAI embedding failed — falling back to TF-IDF", err);
    return null;
  }
}

/** Cosine similarity between two dense vectors. */
export function denseCosineSimilarity(
  a: EmbeddingVector,
  b: EmbeddingVector
): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
