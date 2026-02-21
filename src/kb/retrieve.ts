import { DenialCase, RetrievedChunk } from "../types";
import { KBStore } from "./store";

export interface SearchFilters {
  payerName?: string;
  docType?: string;
  tags?: string[];
}

/** Search the KB for chunks matching a query. */
export function searchKB(
  store: KBStore,
  query: string,
  filters: SearchFilters,
  topK = 8
): RetrievedChunk[] {
  return store.search(query, filters, topK);
}

/**
 * Multi-query retrieval for a DenialCase.
 * Runs several targeted queries and deduplicates by chunkId,
 * keeping the highest score per chunk.
 */
export function retrieveForCase(
  store: KBStore,
  denialCase: DenialCase,
  topKPerQuery = 5,
  maxTotal = 15
): RetrievedChunk[] {
  const payer = denialCase.payerName.value ?? undefined;
  const category = denialCase.denialCategory.value ?? "other";
  const cptCodes = (denialCase.services.value ?? [])
    .flatMap((s) => s.cptCodes)
    .join(" ");
  const policyRefs = (denialCase.policyReferences.value ?? [])
    .map((p) => p.policyId)
    .join(" ");
  const serviceName = (denialCase.services.value ?? [])
    .map((s) => s.serviceName)
    .join(" ");
  const providerName = denialCase.providerName.value ?? "";

  // Construct targeted retrieval queries
  const queries: Array<{ q: string; filters: SearchFilters }> = [
    // Query 1: Payer + policy references + category
    {
      q: `${payer ?? ""} ${policyRefs} ${category} denial appeal`.trim(),
      filters: { payerName: payer },
    },
    // Query 2: CPT codes + category + medical necessity
    {
      q: `${cptCodes} ${category} appeal medical necessity functional improvement`,
      filters: {},
    },
    // Query 3: Prior accepted appeals for this payer + category
    {
      q: `${payer ?? ""} ${serviceName} successful appeal ${category}`.trim(),
      filters: { docType: "prior_appeal_accepted", payerName: payer },
    },
    // Query 4: Exact policy bulletin reference if present
    ...(policyRefs
      ? [
          {
            q: policyRefs,
            filters: { docType: "policy" } as SearchFilters,
          },
        ]
      : []),
    // Query 5: Clinical evidence + service name
    {
      q: `${serviceName} ${category} clinical documentation sessions benefit limit`,
      filters: { docType: "clinical" },
    },
    // Query 6: General template for same category
    {
      q: `${category} appeal letter template`,
      filters: { docType: "template" },
    },
  ];

  // Run all queries and merge
  const seen = new Map<string, RetrievedChunk>();

  for (const { q, filters } of queries) {
    if (!q.trim()) continue;
    const results = store.search(q, filters, topKPerQuery);
    for (const chunk of results) {
      const existing = seen.get(chunk.chunkId);
      if (!existing || chunk.score > existing.score) {
        seen.set(chunk.chunkId, chunk);
      }
    }
  }

  // Sort by score descending, take maxTotal
  return [...seen.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, maxTotal);
}
