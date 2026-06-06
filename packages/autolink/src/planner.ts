import type { EdgeLabelInstance, NodeLabelInstance, SearchHit } from "@khoralabs/memories-core";
import {
  RETRIEVAL_AUTOLINK_EDGE_KIND,
  RETRIEVAL_BOOTSTRAP_NODE_KIND,
  type RetrievalAutolinkEdgeLabels,
  type RetrievalAutolinkNodeLabels,
  zRetrievalAutolinkEdgeProps,
} from "./ontology.js";

export type LexicalLinkMergePatch = {
  labels?: NodeLabelInstance<RetrievalAutolinkNodeLabels>[];
  edges?: Array<{
    memory_key: string;
    direction: "in" | "out";
    label: EdgeLabelInstance<RetrievalAutolinkEdgeLabels>;
    properties?: Record<string, unknown>;
  }>;
};

export type ComputeLexicalLinkOptions = {
  /** Snapshot persisted on every emitted edge (`similarityScore` companion). */
  searchConfig: Record<string, unknown>;
  /** Max edges after dedupe, filter, and stable sort. */
  topK: number;
  minSimilarityScore?: number;
  /** When true (default), ignore hits whose primary memory is an edge memory. */
  skipEdgeMemories?: boolean;
  /** When true, add {@link RETRIEVAL_BOOTSTRAP_NODE_KIND} on the source if at least one edge is emitted. */
  tagSourceNode?: boolean;
};

type AggregatedHit = {
  memoryKey: string;
  score: number;
  sourceKey: string;
};

/**
 * Pure: from ranked search hits, build a merge patch (retrieval autolink edges + optional bootstrap node label).
 * No I/O. Deterministic: sort by descending score, then neighbor key.
 */
export function computeLexicalLinkMergeSlice(
  sourceMemoryKey: string,
  searchHits: readonly SearchHit[],
  options: ComputeLexicalLinkOptions,
): LexicalLinkMergePatch {
  const skipEdge = options.skipEdgeMemories ?? true;
  const frozenConfig = { ...options.searchConfig };

  const byKey = new Map<string, AggregatedHit>();

  for (const hit of searchHits) {
    const memoryKey = hit.memory.key;
    if (memoryKey === sourceMemoryKey) continue;
    if (skipEdge && hit.memory.kind === "edge") continue;

    const next: AggregatedHit = {
      memoryKey,
      score: hit.score,
      sourceKey: hit.source_key,
    };
    const prev = byKey.get(memoryKey);
    if (prev !== undefined && prev.score >= next.score) continue;
    byKey.set(memoryKey, next);
  }

  let rows = [...byKey.values()].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.memoryKey.localeCompare(b.memoryKey);
  });

  const minScore = options.minSimilarityScore;
  if (minScore !== undefined) {
    rows = rows.filter((r) => r.score >= minScore);
  }

  const topK = Math.max(0, Math.floor(options.topK));
  rows = rows.slice(0, topK);

  const edges: NonNullable<LexicalLinkMergePatch["edges"]> = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r === undefined) continue;
    const props = zRetrievalAutolinkEdgeProps.parse({
      similarityScore: r.score,
      searchConfig: frozenConfig,
      rank: i,
      hitMemoryKey: r.memoryKey,
      hitSourceKey: r.sourceKey,
    });
    edges.push({
      memory_key: r.memoryKey,
      direction: "out",
      label: { kind: RETRIEVAL_AUTOLINK_EDGE_KIND, props },
    });
  }

  const labels: NonNullable<LexicalLinkMergePatch["labels"]> = [];
  if ((options.tagSourceNode ?? false) && edges.length > 0) {
    labels.push({
      kind: RETRIEVAL_BOOTSTRAP_NODE_KIND,
      props: { source: "lexical_autolink" },
    });
  }

  const out: LexicalLinkMergePatch = {};
  if (edges.length > 0) out.edges = edges;
  if (labels.length > 0) out.labels = labels;
  return out;
}
