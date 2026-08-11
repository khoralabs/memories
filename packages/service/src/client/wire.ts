import type { SearchHit } from "@khoralabs/memories-node";

export const MAX_NEIGHBORS_PER_HIT = 8;

export type OntologyLabelWire = {
  kind: string;
  props: Record<string, unknown>;
};

export type GraphEdgeLinkWire = {
  edgeId: string;
  fromKey: string;
  toKey: string;
  labels: OntologyLabelWire[];
  properties?: Record<string, unknown> | null;
  directed?: boolean;
};

export type MemoryWire = {
  namespace: string;
  key: string;
  kind: "node" | "edge";
  edge_id?: string;
  /** Exact-path `memories.suppressed` flag. */
  suppressed: boolean;
};

export type SearchNeighborHitWire = {
  namespace: string;
  key: string;
  kind: "node" | "edge";
  labels: OntologyLabelWire[];
  edge: {
    from_node_id: string;
    to_node_id: string;
    properties?: Record<string, unknown>;
    label: OntologyLabelWire;
  };
  neighborScore?: number;
  matchedSourceMapId?: string;
  /** Exact-path `memories.suppressed` flag. */
  suppressed: boolean;
};

export type SearchHitWire = {
  id: string;
  memoryId: string;
  sourceKey: string;
  score: number;
  memory: MemoryWire;
  labels: OntologyLabelWire[];
  graph: { kind: "node" } | { kind: "edge"; edge: GraphEdgeLinkWire };
  neighbors?: SearchNeighborHitWire[];
};

export type SearchContentWire =
  | { text: string }
  | { vector: number[] }
  | { text: string; vector: number[] };

export type SearchParamsWire = {
  namespace: string;
  additionalNamespaces?: string[];
  searchEntireDatabase?: true;
  searchScopeMode?: "pathSubtree" | "scopeDag" | "exactScope";
  content: SearchContentWire;
  options?: {
    topK?: number;
    minScore?: number;
    labels?: { all?: string[]; some?: string[] };
    neighbors?: boolean | { all?: unknown[]; some?: unknown[] };
    maxNeighbors?: number;
    arms?: { vector?: number; lexical?: number };
    maxVectorDistance?: number;
    vectorSearchMethod?: "knn" | "ann";
    /** When true, include suppressed memories/namespaces in discovery. Default excludes. */
    includeSuppressed?: boolean;
  };
  asOf?: {
    gt?: number;
    gte?: number;
    lt?: number;
    lte?: number;
  };
  /** @deprecated Prefer `asOf: { lte }`. */
  asOfTimestampMs?: number;
};

export type DeleteMemoryParamsWire = {
  namespace: string;
  key: string;
};

export type SuppressMemoryParamsWire = {
  namespace: string;
  key: string;
};

export type SuppressNamespaceParamsWire = {
  namespace: string;
};

export type DatabaseScopedBody<T> = {
  database: { kind: string; ownerKey: string };
} & T;

export type DatabaseHashRequest = {
  database: { kind: string; ownerKey: string };
};
export type DatabaseHashResponse = { hash: string | null };

export type DatabaseSearchRequest = DatabaseScopedBody<{ params: SearchParamsWire }>;
export type DatabaseSearchResponse = {
  hits: SearchHitWire[];
  vectorSearchMethod?: "knn" | "ann";
};

export type DatabaseSearchNamespacesRequest = DatabaseScopedBody<{
  /** Query text (required). */
  query: string;
  /**
   * Primary namespace for SearchParams when `under` is unset (required by unscoped search).
   * Defaults to `"_global_"` on the handler when omitted.
   */
  namespace?: string;
  /** Optional path filter after aggregation (inclusive). */
  under?: string;
  limit?: number;
  nodeTopK?: number;
  /**
   * Arm weights for nodes / catalog lexical ranking.
   * This endpoint is embedding-agnostic: omitted `arms.vector` is treated as `0`
   * (unless `vector` is supplied and `arms` is omitted, then vector arm defaults to `1`).
   * `arms.vector > 0` requires a client-supplied `vector` (512–3072 float32).
   */
  arms?: { nodes?: number; lexical?: number; vector?: number };
  /** Optional query embedding (512–3072 floats); required when arms.vector > 0. */
  vector?: number[];
  /** When true, include suppressed namespaces/memories. Default excludes. */
  includeSuppressed?: boolean;
}>;
export type DatabaseSearchNamespacesResponse = {
  query: string;
  under: string | null;
  namespaces: Array<{
    namespace: string;
    lineage: string[];
    score: number;
    hitCount: number;
    scoreSum: number;
    scoreMax: number;
    topHits: Array<{ memory_key: string; score: number; kind: "node" | "edge" }>;
    suppressed: boolean;
  }>;
};

export type DatabaseMergeRequest = DatabaseScopedBody<{
  params: Record<string, unknown>;
  intentSnapshotId?: string;
}>;
export type DatabaseMergeResponse = { memoryIds: string[] };

export type DatabaseDeleteMemoryRequest = DatabaseScopedBody<
  DeleteMemoryParamsWire & { intentSnapshotId?: string }
>;
export type DatabaseDeleteMemoryResponse = { ok: true };

export type DatabaseSuppressMemoryRequest = DatabaseScopedBody<
  SuppressMemoryParamsWire & { intentSnapshotId?: string }
>;
export type DatabaseSuppressMemoryResponse = { ok: true };

export type DatabaseUnsuppressMemoryRequest = DatabaseScopedBody<
  SuppressMemoryParamsWire & { intentSnapshotId?: string }
>;
export type DatabaseUnsuppressMemoryResponse = { ok: true };

export type DatabaseSuppressNamespaceRequest = DatabaseScopedBody<
  SuppressNamespaceParamsWire & { intentSnapshotId?: string }
>;
export type DatabaseSuppressNamespaceResponse = { ok: true };

export type DatabaseUnsuppressNamespaceRequest = DatabaseScopedBody<
  SuppressNamespaceParamsWire & { intentSnapshotId?: string }
>;
export type DatabaseUnsuppressNamespaceResponse = { ok: true };

export type DatabaseProvenanceHeadRequest = DatabaseScopedBody<Record<string, never>>;
export type DatabaseProvenanceHeadResponse = { rootHex: string };

export type DatabaseProvenanceTimestampRequest = DatabaseScopedBody<{ rootHex: string }>;
export type DatabaseProvenanceTimestampResponse = { timestampMs: number | null };

export type DatabaseProvenanceEventsRequest = DatabaseScopedBody<{
  namespace?: string;
  key?: string;
  limit?: number;
  before?: { createdAt: number; id: string };
}>;
export type DatabaseProvenanceEventItem = {
  id: string;
  rootHex: string;
  parentRootHex: string;
  eventType: string;
  createdAt: number;
  event: Record<string, unknown>;
  intentSnapshotId?: string;
};
export type DatabaseProvenanceEventsResponse = {
  events: DatabaseProvenanceEventItem[];
  nextBefore?: { createdAt: number; id: string };
  database: { kind: string; ownerKey: string };
};

export type DatabaseProvenanceChainRequest = DatabaseScopedBody<{
  limit?: number;
  beforeRootHex?: string;
}>;
export type DatabaseProvenanceChainLink = {
  rootHex: string;
  parentRootHex: string;
  eventType: string;
  createdAt: number;
  id: string;
};
export type DatabaseProvenanceChainResponse = {
  links: DatabaseProvenanceChainLink[];
  nextBeforeRootHex?: string;
  database: { kind: string; ownerKey: string };
};

export type DatabaseProvenanceContentRequest = DatabaseScopedBody<{
  rootHex: string;
  namespace: string;
  key: string;
}>;
export type DatabaseProvenanceContentResponse = {
  rootHex: string;
  content: Array<{ sourceKey: string; text: string }>;
  database: { kind: string; ownerKey: string };
};

export type DatabaseCapabilitiesRequest = DatabaseScopedBody<Record<string, never>>;
export type DatabaseCapabilitiesResponse = {
  capabilities: Record<string, boolean | undefined>;
  /** Effective host write limits for namespace paths. */
  namespaceLimits: { maxDepth: number; maxLength: number };
};

export type DatabaseNamespacesRequest = DatabaseScopedBody<{
  /** When true, include suppressed namespaces (self/ancestor). Default excludes. */
  includeSuppressed?: boolean;
}>;
/**
 * Namespace catalog row on the wire (⊆ node `NamespaceMetadataInfo`).
 * `suppressed` is the exact-path flag.
 */
export type DatabaseNamespaceMetadata = {
  namespace: string;
  alias: string | null;
  description: string;
  suppressed: boolean;
};
export type DatabaseNamespacesResponse = { namespaces: DatabaseNamespaceMetadata[] };

/** Path-boundary prefix (`= prefix` or nested under `prefix/`). */
export type DatabaseNamespacesUnderPrefixRequest = DatabaseScopedBody<{
  prefix: string;
  includeSuppressed?: boolean;
}>;
export type DatabaseNamespacesUnderPrefixResponse = {
  namespaces: DatabaseNamespaceMetadata[];
};

export type DatabaseNamespaceExistsUnderPrefixRequest = DatabaseScopedBody<{
  prefix: string;
  includeSuppressed?: boolean;
}>;
export type DatabaseNamespaceExistsUnderPrefixResponse = { exists: boolean };

export type DatabaseNamespaceGetRequest = DatabaseScopedBody<{ namespace: string }>;
export type DatabaseNamespaceGetResponse = {
  namespace: DatabaseNamespaceMetadata | null;
};

export type DatabaseNamespaceUpsertRequest = DatabaseScopedBody<{
  namespace: string;
  alias?: string | null;
  /** @deprecated Use `alias`. */
  displayName?: string | null;
  description?: string;
}>;
export type DatabaseNamespaceUpsertResponse = { namespace: DatabaseNamespaceMetadata };

export type DatabaseNamespaceDeleteRequest = DatabaseScopedBody<{
  namespace: string;
  recursive?: boolean;
}>;
export type DatabaseNamespaceDeleteResponse = {
  namespaces: string[];
  deletedMemories: number;
};

export type DatabaseNamespaceRenameRequest = DatabaseScopedBody<{
  from: string;
  to: string;
  recursive?: boolean;
}>;
export type DatabaseNamespaceRenameResponse = {
  namespaces: Array<{ from: string; to: string }>;
  renamedMemories: number;
};

export type DatabaseMetadataGetRequest = DatabaseScopedBody<Record<string, never>>;
export type DatabaseMetadataGetResponse = { name: string; description: string };

export type DatabaseMetadataUpsertRequest = DatabaseScopedBody<{
  name?: string;
  description?: string;
}>;
export type DatabaseMetadataUpsertResponse = { name: string; description: string };

export type DatabaseListEntry = {
  id: { kind: string; ownerKey: string };
  name: string;
  description: string;
};
export type DatabaseListResponse = { databases: DatabaseListEntry[] };

export type DatabaseEdgePreviewRequest = DatabaseScopedBody<{
  namespace: string;
  edgeId: string;
  /** When true, return suppressed edges. Default excludes (404 when suppressed). */
  includeSuppressed?: boolean;
}>;
export type DatabaseEdgePreviewResponse = {
  edgeId: string;
  fromKey: string;
  toKey: string;
  labels: OntologyLabelWire[];
  properties: Record<string, unknown> | null;
  /** Exact-path edge-memory suppressed flag. */
  suppressed: boolean;
};

export type DatabaseMemoryPreviewRequest = DatabaseScopedBody<{
  namespace: string;
  key: string;
  maxChars?: number;
}>;
export type DatabaseMemoryPreviewResponse = {
  key: string;
  namespace: string;
  labels: OntologyLabelWire[];
  content: Array<{
    sourceKey: string;
    sourceMapId: string;
    text: string | null;
    hasText: boolean;
    hasVector: boolean;
    contentHash?: string;
    createdAt: number;
  }>;
  /** Freeform JSON from `nodes.properties` (not ontology label props). */
  properties: Record<string, unknown> | null;
  /** Exact-path `memories.suppressed` flag. */
  suppressed: boolean;
};

export type DatabaseSourceMapTextPreviewRequest = DatabaseScopedBody<{
  sourceMapId: string;
  maxChars?: number;
}>;
export type DatabaseSourceMapTextPreviewResponse = { text: string | null };

export type DatabaseSourceMapTextRequest = DatabaseScopedBody<{
  sourceMapId: string;
}>;
export type DatabaseSourceMapTextResponse = { text: string | null };

export type DatabaseSourceMapReplaceRequest = DatabaseScopedBody<{
  namespace: string;
  key: string;
  sourceKey: string;
  text?: string;
  vector?: number[];
  intentSnapshotId?: string;
}>;
export type DatabaseSourceMapReplaceResponse = {
  sourceMapId: string;
  rootHex: string;
};

export type DatabaseVectorDimensionsRequest = DatabaseScopedBody<Record<string, never>>;
export type DatabaseVectorDimensionsResponse = { dimensions: number[] };

export type DatabaseProjectionInputRequest = DatabaseScopedBody<{
  namespace: string;
  scope?: "exact" | "subtree";
  compression?: "gzip" | "none";
  includeProvenanceHead?: boolean;
  includeSuppressed?: boolean;
}>;

/** @deprecated Use DatabaseProjectionInputRequest */
export type DatabaseUmapInputRequest = DatabaseProjectionInputRequest;

export type DatabaseGraphLayoutRequest = DatabaseScopedBody<{
  namespace: string;
  scope?: "exact" | "subtree";
  includeSuppressed?: boolean;
}>;

export type DatabaseGraphCountsRequest = DatabaseScopedBody<{
  namespace: string;
  scope?: "exact" | "subtree";
  includeSuppressed?: boolean;
}>;
export type DatabaseGraphCountsResponse = {
  namespace: string;
  scope: "exact" | "subtree";
  nodeCount: number;
  edgeCount: number;
};

export type DatabaseGraphStatsRequest = DatabaseScopedBody<{
  namespace: string;
  scope?: "exact" | "subtree";
  includeSuppressed?: boolean;
}>;
export type DatabaseGraphStatsResponse = DatabaseGraphCountsResponse & {
  suppressedNodeCount: number;
  suppressedEdgeCount: number;
  labelKinds: {
    nodes: Record<string, number>;
    edges: Record<string, number>;
  };
};

export type DatabaseEnsureScopeChainRequest = DatabaseScopedBody<{ scopePaths: string[] }>;
export type DatabaseEnsureScopeChainResponse = { ok: true };

export type DatabaseFindMemoryIdRequest = DatabaseScopedBody<{ namespace: string; key: string }>;
export type DatabaseFindMemoryIdResponse = {
  memoryId: string | null;
  /** Present when `memoryId` is non-null. Exact-path flag. */
  suppressed?: boolean;
};

/**
 * Ancestor-aware suppression status (discovery visibility).
 * Omit `key` for a namespace target; include `key` for a memory target.
 */
export type DatabaseEffectiveSuppressionRequest = DatabaseScopedBody<{
  namespace: string;
  key?: string;
}>;
export type DatabaseEffectiveSuppressionResponse = {
  namespace: string;
  /** Present for memory targets. */
  key?: string;
  /** True when discovery would hide this target (memory flag and/or covering namespace). */
  effectivelySuppressed: boolean;
  /** Closest covering suppressed namespace (self or ancestor); null when none. */
  suppressedBy: string | null;
  /** Exact-path flag for the target (`namespace_metadata` / `memories`). */
  exactSuppressed: boolean;
};

export type DatabaseLoadMemoryNamespaceKeyRequest = DatabaseScopedBody<{ memoryId: string }>;
export type DatabaseLoadMemoryNamespaceKeyResponse = {
  namespace: string;
  key: string;
  suppressed: boolean;
} | null;

function serializeLabel(label: {
  kind: string;
  props: Record<string, unknown>;
}): OntologyLabelWire {
  return { kind: label.kind, props: label.props ?? {} };
}

export function serializeSearchHit(hit: SearchHit): SearchHitWire {
  const row = hit as SearchHit & { _id: string; memory_id: string; source_key: string };
  const wire: SearchHitWire = {
    id: row._id,
    memoryId: row.memory_id,
    sourceKey: row.source_key,
    score: hit.score,
    memory: {
      namespace: hit.memory.namespace,
      key: hit.memory.key,
      kind: hit.memory.kind,
      ...(hit.memory.edge_id !== undefined ? { edge_id: hit.memory.edge_id } : {}),
      suppressed: hit.memory.suppressed === 1,
    },
    labels: hit.labels.map(serializeLabel),
    graph:
      hit.graph.kind === "node"
        ? { kind: "node" }
        : {
            kind: "edge",
            edge: {
              edgeId: hit.graph.edge.edgeId,
              fromKey: hit.graph.edge.fromKey,
              toKey: hit.graph.edge.toKey,
              labels: hit.graph.edge.labels.map(serializeLabel),
              properties: hit.graph.edge.properties,
              directed: hit.graph.edge.directed,
            },
          },
  };
  if (hit.neighbors !== undefined && hit.neighbors.length > 0) {
    wire.neighbors = hit.neighbors.slice(0, MAX_NEIGHBORS_PER_HIT).map((n) => ({
      namespace: n.namespace,
      key: n.key,
      kind: n.kind,
      labels: n.labels.map(serializeLabel),
      edge: {
        from_node_id: n.edge.from_node_id,
        to_node_id: n.edge.to_node_id,
        properties: n.edge.properties,
        label: serializeLabel(n.edge.label),
      },
      ...(n.neighborScore !== undefined ? { neighborScore: n.neighborScore } : {}),
      ...(n.matchedSourceMapId !== undefined ? { matchedSourceMapId: n.matchedSourceMapId } : {}),
      suppressed: n.suppressed === 1,
    }));
  }
  return wire;
}

export function deserializeSearchHit(wire: SearchHitWire): Record<string, unknown> {
  return {
    _id: wire.id,
    memory_id: wire.memoryId,
    source_key: wire.sourceKey,
    score: wire.score,
    memory: {
      namespace: wire.memory.namespace,
      key: wire.memory.key,
      kind: wire.memory.kind,
      ...(wire.memory.edge_id !== undefined ? { edge_id: wire.memory.edge_id } : {}),
      suppressed: wire.memory.suppressed === true ? (1 as const) : (0 as const),
    },
    labels: wire.labels.map((l) => ({ kind: l.kind, props: l.props ?? {} })),
    graph:
      wire.graph.kind === "node"
        ? { kind: "node" as const }
        : {
            kind: "edge" as const,
            edge: {
              edgeId: wire.graph.edge.edgeId,
              fromKey: wire.graph.edge.fromKey,
              toKey: wire.graph.edge.toKey,
              labels: wire.graph.edge.labels.map((l) => ({
                kind: l.kind,
                props: l.props ?? {},
              })),
              properties: wire.graph.edge.properties ?? null,
              ...(wire.graph.edge.directed !== undefined
                ? { directed: wire.graph.edge.directed }
                : {}),
            },
          },
    ...(wire.neighbors !== undefined && wire.neighbors.length > 0
      ? {
          neighbors: wire.neighbors.slice(0, MAX_NEIGHBORS_PER_HIT).map((n) => ({
            namespace: n.namespace,
            key: n.key,
            kind: n.kind,
            labels: n.labels.map((l) => ({ kind: l.kind, props: l.props ?? {} })),
            edge: {
              from_node_id: n.edge.from_node_id,
              to_node_id: n.edge.to_node_id,
              properties: n.edge.properties,
              label: { kind: n.edge.label.kind, props: n.edge.label.props ?? {} },
            },
            ...(n.neighborScore !== undefined ? { neighborScore: n.neighborScore } : {}),
            ...(n.matchedSourceMapId !== undefined
              ? { matchedSourceMapId: n.matchedSourceMapId }
              : {}),
            suppressed: n.suppressed === true ? (1 as const) : (0 as const),
          })),
        }
      : {}),
  };
}

export function deserializeSearchHits(wires: SearchHitWire[]): Record<string, unknown>[] {
  return wires.map(deserializeSearchHit);
}
