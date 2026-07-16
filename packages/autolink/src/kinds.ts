/** Edge kind for search-derived similarity between two memories. */
export const RETRIEVAL_SIMILARITY_EDGE_KIND = "retrieval_similarity" as const;

/** Node kind marking a memory used as a seed for retrieval expansion. */
export const RETRIEVAL_SEED_NODE_KIND = "retrieval_seed" as const;

export type RetrievalSimilarityEdgeProps = {
  similarityScore: number;
  searchConfig: Record<string, unknown>;
  rank?: number;
  hitMemoryKey?: string;
  hitSourceKey?: string;
};

export type RetrievalSeedNodeProps = {
  source: "lexical_search";
};
