import type { NamespacePath, SearchContent, SearchParams } from "@khoralabs/memories-core";

export type SearchConfigSnapshotInput = {
  namespace: NamespacePath;
  content: SearchContent;
  options?: SearchParams["options"];
  additionalNamespaces?: NamespacePath[];
  searchEntireDatabase?: true;
};

/**
 * Normalizes search call parameters into a JSON-stable object stored on each
 * {@link RETRIEVAL_AUTOLINK_EDGE_KIND} edge (`searchConfig` prop).
 */
export function normalizeSearchConfigSnapshot(
  input: SearchConfigSnapshotInput,
): Record<string, unknown> {
  const o = input.options ?? {};
  const c = input.content;
  const contentMode = "text" in c && "vector" in c ? "hybrid" : "text" in c ? "lexical" : "vector";

  const out: Record<string, unknown> = {
    namespace: String(input.namespace),
    contentMode,
    topK: o.topK,
    minScore: o.minScore,
    neighbors: o.neighbors as unknown,
    maxNeighbors: o.maxNeighbors,
    arms: o.arms,
    maxVectorDistance: o.maxVectorDistance,
    labels: o.labels,
  };

  if (input.additionalNamespaces?.length) {
    out.additionalNamespaces = input.additionalNamespaces.map(String);
  }
  if (input.searchEntireDatabase) {
    out.searchEntireDatabase = true;
  }

  return out;
}
