/** Wire shape for ontology label instances (matches `@khoralabs/memories-core` JSON). */
export type GraphLabelInstance = {
  kind: string;
  props: Record<string, unknown>;
};

/** Response shape from `GET /api/graph`. */
export type GraphPayload = {
  namespace: string;
  nodes: Array<{ key: string; x: number; y: number; z: number; labels: GraphLabelInstance[] }>;
  edges: Array<{
    edgeId: string;
    fromKey: string;
    toKey: string;
    labels: GraphLabelInstance[];
    /** When true, dashes animate from `fromKey` toward `toKey`; omit/false = undirected (static dashes). */
    directed?: boolean;
  }>;
};

/** When set, nodes outside `relevantKeys` are dimmed (search hits ∪ neighbors). */
export type GraphSearchState = {
  relevantKeys: ReadonlySet<string>;
  hitCount: number;
  /**
   * Lexical text for the matched `source_map` on each **root** search hit only (not neighbors).
   * Best-ranked snippet wins when several hits share the same memory key.
   */
  hitSnippetByKey: ReadonlyMap<string, string>;
  /** Snippet text for edge-kind root hits, keyed by stable graph `edgeId` from `GET /api/graph`. */
  hitSnippetByEdgeId: ReadonlyMap<string, string>;
};

/** 3D marker in the projection scene (`[-1, 1]` per axis from layout). */
export type ProjectionPoint = {
  entryId: string;
  key: string;
  x: number;
  y: number;
  z: number;
  labels: GraphLabelInstance[];
};

/** World-space scale for layout coordinates. */
export const SCALE = 2;

/** Graph segment for drawing; directed edges keep API order, undirected merges use sorted keys. */
export type SceneEdge = {
  key: string;
  edgeId: string;
  fromKey: string;
  toKey: string;
  labels: GraphLabelInstance[];
  /** When true, dash scroll follows `fromKey` → `toKey`. */
  directed?: boolean;
};

export function graphLabelFingerprint(l: GraphLabelInstance): string {
  return `${l.kind}\0${JSON.stringify(l.props)}`;
}

/** Sorted endpoints — multiple `SceneEdge` rows can share one geometric segment (see graph midpoint labels). */
export function sceneEdgePairMergeKey(e: SceneEdge): string {
  const a = e.fromKey < e.toKey ? e.fromKey : e.toKey;
  const b = e.fromKey < e.toKey ? e.toKey : e.fromKey;
  return `${a}\0${b}`;
}

/**
 * Union ontology labels from every scene edge on that segment — matches merged labels in the graph view.
 * Keeps `key`, `edgeId`, endpoints, and `directed` from `primary` (hovered / pinned pick).
 */
export function mergeSceneEdgesForPairPreview(
  primary: SceneEdge,
  allEdges: SceneEdge[],
): SceneEdge {
  const pairKey = sceneEdgePairMergeKey(primary);
  const labelMap = new Map<string, GraphLabelInstance>();
  for (const e of allEdges) {
    if (sceneEdgePairMergeKey(e) !== pairKey) continue;
    for (const lb of e.labels) {
      labelMap.set(graphLabelFingerprint(lb), lb);
    }
  }
  return {
    ...primary,
    labels: [...labelMap.values()].sort((a, b) => a.kind.localeCompare(b.kind)),
  };
}

export function formatGraphLabelShort(l: GraphLabelInstance): string {
  const keys = Object.keys(l.props);
  if (keys.length === 0) return l.kind;
  return `${l.kind} (${keys.length} props)`;
}
