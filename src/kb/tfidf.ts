/**
 * TF-IDF cosine similarity retrieval.
 * Deterministic, runs fully in-process with no external dependencies.
 *
 * Algorithm:
 *  1. Tokenize text → lowercase unigrams + bigrams, stripped of stop words.
 *  2. TF: log-normalized term frequency = log(1 + count(t, d)).
 *  3. IDF: computed over stored corpus; provided at query time via allVectors.
 *  4. Cosine similarity between query vector and each chunk vector.
 */

const STOP_WORDS = new Set([
  "a","an","the","and","or","but","in","on","at","to","for","of","with",
  "by","from","up","about","into","through","during","is","are","was","were",
  "be","been","being","have","has","had","do","does","did","will","would",
  "could","should","may","might","shall","can","not","no","nor","so","yet",
  "both","either","neither","each","few","more","most","other","some","such",
  "than","too","very","just","as","if","then","that","this","these","those",
  "it","its","he","she","they","we","you","i","me","my","our","your","their",
  "his","her","its","which","who","whom","what","when","where","why","how",
]);

export type TFIDFVector = Record<string, number>;

/** Tokenize text into unigrams and bigrams, removing stop words. */
export function tokenize(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s\-#]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));

  const tokens: string[] = [...words];

  // Add bigrams for better phrase matching (e.g. "medical necessity", "CPT 97110")
  for (let i = 0; i < words.length - 1; i++) {
    tokens.push(`${words[i]}_${words[i + 1]}`);
  }

  return tokens;
}

/** Compute log-normalized TF vector for a document. */
export function computeTF(tokens: string[]): TFIDFVector {
  const counts: Record<string, number> = {};
  for (const t of tokens) {
    counts[t] = (counts[t] ?? 0) + 1;
  }
  const tf: TFIDFVector = {};
  for (const [term, count] of Object.entries(counts)) {
    tf[term] = Math.log(1 + count);
  }
  return tf;
}

/**
 * Build a TF-IDF vector for text given the corpus IDF map.
 * If IDF map is empty (no corpus yet), falls back to pure TF.
 */
export function buildVector(text: string, idf: TFIDFVector): TFIDFVector {
  const tokens = tokenize(text);
  const tf = computeTF(tokens);
  const vector: TFIDFVector = {};
  for (const [term, tfScore] of Object.entries(tf)) {
    const idfScore = idf[term] ?? Math.log(1 + 1); // unseen term: small weight
    vector[term] = tfScore * idfScore;
  }
  return vector;
}

/**
 * Compute IDF from an array of TF vectors (one per document/chunk).
 * IDF(t) = log((N + 1) / (df(t) + 1)) + 1  (smoothed)
 */
export function computeIDF(tfVectors: TFIDFVector[]): TFIDFVector {
  const N = tfVectors.length;
  if (N === 0) return {};

  const df: Record<string, number> = {};
  for (const vec of tfVectors) {
    for (const term of Object.keys(vec)) {
      df[term] = (df[term] ?? 0) + 1;
    }
  }

  const idf: TFIDFVector = {};
  for (const [term, count] of Object.entries(df)) {
    idf[term] = Math.log((N + 1) / (count + 1)) + 1;
  }
  return idf;
}

/** Cosine similarity between two sparse vectors. */
export function cosineSimilarity(a: TFIDFVector, b: TFIDFVector): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (const [term, w] of Object.entries(a)) {
    normA += w * w;
    if (b[term] !== undefined) {
      dot += w * b[term];
    }
  }
  for (const w of Object.values(b)) {
    normB += w * w;
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/** Score a query string against a stored vector, given corpus IDF. */
export function scoreQuery(
  query: string,
  storedVector: TFIDFVector,
  idf: TFIDFVector
): number {
  const queryVector = buildVector(query, idf);
  return cosineSimilarity(queryVector, storedVector);
}

/** Build a fresh TF vector for text (for storing without IDF — IDF applied at query time). */
export function buildTFVector(text: string): TFIDFVector {
  return computeTF(tokenize(text));
}
