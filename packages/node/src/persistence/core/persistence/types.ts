import type { NamespacePath } from "../models/namespace-path";
import type {
  HydratedNeighbor,
  HydratedSourceMapHit,
  NeighborFilter,
} from "../models/neighbor-search-types";
import type { OntologyLabelInstance } from "../models/ontology-label";
import type {
  ContributorAttestation,
  MemoryProvenanceEvent,
  SourceMapBodyParts,
} from "../provenance/index";
import type { MemoryKind, SourceMap, TextFeatureExportRow } from "./row-schemas";

/** Timestamp context for writes and validators that use `_ts_created`. */
export type MemoryOpContext = {
  now: number;
  contributor?: ContributorAttestation;
  intentSnapshotId?: string;
};

/**
 * Namespace display metadata for UI (path key + optional display name + description).
 * `displayName` null means callers should show {@link namespace}.
 */
export type NamespaceMetadataInfo = {
  namespace: NamespacePath;
  displayName: string | null;
  description: string;
};

/** Graph edge summary (storage-agnostic shape). */
export type GraphEdgeLink = {
  edgeId: string;
  fromKey: string;
  toKey: string;
  labels: OntologyLabelInstance[];
  /**
   * JSON from the `edges` row (not label-assignment props; those are under {@link labels}).
   * Omitted or null when absent or empty.
   */
  properties?: Record<string, unknown> | null;
  /**
   * When true, visualization keeps `fromKey` → `toKey` (e.g. dash flow, no undirected merge).
   * Set when the stored edge is directed (e.g. merge-created links).
   */
  directed?: boolean;
};

/** Primary graph node for a memory (1:1 with `memories.key` in the reference store). */
export type GraphNode = {
  namespace: NamespacePath;
  memoryKey: string;
  /** Stable graph id (`ids.node(namespace, memoryKey)` in core). */
  nodeId: string;
  labels: OntologyLabelInstance[];
  /** Parsed `nodes.properties`; `null` when absent or empty. */
  properties: Record<string, unknown> | null;
};

/** Mean-pooled embedding per memory for layout (storage-agnostic shape). */
export type GraphMemoryEmbedding = {
  memoryKey: string;
  memoryId: string;
  embedding: number[];
};

export type EdgePreviewPayload = {
  edgeId: string;
  fromKey: string;
  toKey: string;
  labels: OntologyLabelInstance[];
  properties: Record<string, unknown> | null;
};

/**
 * Features the backend exposes for hybrid search and graph expansion.
 * Omitted keys default via {@link resolveMemoriesBackendCapabilities} (see {@link DEFAULT_MEMORIES_BACKEND_CAPABILITIES}).
 */
export type MemoriesBackendCapabilities = {
  lexicalSearch: boolean;
  vectorSearch: boolean;
  /** Exact / linear cosine vector search (`knn`). Backends must opt in. */
  vectorKnnSearch: boolean;
  /** Approximate vector index search (`ann`). Backends must opt in. */
  vectorAnnSearch: boolean;
  neighborIndex: boolean;
  /**
   * When `true`, {@link MemoriesGraphIndex} topology reads are available (edges, labels per namespace, incident edges).
   * When `false`, implementations return empty lists/maps from those methods.
   */
  graphIndex: boolean;
  /** When `true`, retrieval can filter `namespace IN (...)` in one call. When `false`, core merges per-namespace results (RRF). */
  multiNamespaceSearch: boolean;
  /** When `true`, retrieval can run without a namespace predicate (entire DB). Required for `searchEntireDatabase` on `SearchParams`. */
  unscopedSearch: boolean;
  /**
   * When `true`, {@link SearchParams.asOfTimestampMs} is applied to hybrid search (memory `_ts_created` cutoff).
   * Backends that omit this key are treated as unsupported for as-of search.
   */
  asOfTimestampMsSearch?: boolean;
};

/** Vector retrieval algorithm: exact (`knn`) or approximate index (`ann`). */
export type VectorSearchMethod = "knn" | "ann";

/** Rank-ordered vector search result; `vectorSearchMethod` omitted on noop. */
export type SearchVectorSourceMapIdsResult = {
  sourceMapIds: string[];
  vectorSearchMethod?: VectorSearchMethod;
};

/**
 * Resolve which vector method to run from an optional caller preference and capabilities.
 * Explicit selection noops when unsupported; omitted prefers ANN then KNN.
 */
export function resolveVectorSearchMethod(
  requested: VectorSearchMethod | undefined,
  caps: Pick<MemoriesBackendCapabilities, "vectorKnnSearch" | "vectorAnnSearch">,
): VectorSearchMethod | undefined {
  if (requested === "ann") return caps.vectorAnnSearch ? "ann" : undefined;
  if (requested === "knn") return caps.vectorKnnSearch ? "knn" : undefined;
  if (caps.vectorAnnSearch) return "ann";
  if (caps.vectorKnnSearch) return "knn";
  return undefined;
}

/**
 * Namespace / scope filter for {@link MemoriesRetrieval} hybrid search.
 *
 * - **`pathSubtree`:** each path is a prefix root on **primary** `memories.namespace` (equality or descendant path).
 * - **`scopeDag`:** each root is a **scope id**; a memory matches if it is attached to any scope `S`
 *   such that some query root `R` satisfies `(R, S)` in the transitive scope closure (ancestor → descendant).
 * - **`exactScope`:** memory matches only if attached to a scope id **equal** to one of the listed scopes (no DAG descent).
 */
export type SearchNamespaceScope =
  | { kind: "unscoped" }
  | { kind: "pathSubtree"; namespaces: readonly NamespacePath[] }
  | { kind: "scopeDag"; roots: readonly NamespacePath[] }
  | { kind: "exactScope"; scopes: readonly NamespacePath[] };

/** Default when {@link MemoriesPersistence.capabilities} is omitted (full-featured backend). */
export const DEFAULT_MEMORIES_BACKEND_CAPABILITIES: MemoriesBackendCapabilities = {
  lexicalSearch: true,
  vectorSearch: true,
  vectorKnnSearch: false,
  vectorAnnSearch: false,
  neighborIndex: true,
  graphIndex: true,
  multiNamespaceSearch: true,
  unscopedSearch: false,
};

/** Resolve effective capabilities for merge/search logic. */
export function resolveMemoriesBackendCapabilities(persistence: {
  capabilities?: Partial<MemoriesBackendCapabilities>;
}): MemoriesBackendCapabilities {
  return { ...DEFAULT_MEMORIES_BACKEND_CAPABILITIES, ...persistence.capabilities };
}

/**
 * Transactional writes excluding the dedicated {@link MemoriesGraphMutation} surface (memory rows, features, search-meta, etc.).
 */
export interface MemoriesMutationCore {
  /**
   * Run `fn` inside a single transaction; commit on return, rollback on throw.
   * **Note:** Prefer one outer transaction per merge/delete; nesting depends on the driver.
   */
  withTransaction<T>(fn: () => T): T;

  /**
   * Delete all dependent rows for this memory subtree (features, maps, edges, labels, meta, etc.).
   * **Node:** clears incident graph edges (and thus any edge-attached memories referencing them).
   * **Edge:** clears indexed features and edge label assignments; keeps the `edges` row for merge replace via {@link insertEdge}.
   */
  clearMemorySubtree(
    op: MemoryOpContext,
    input:
      | { memoryKind: "node"; memoryId: string; nodeId: string }
      | { memoryKind: "edge"; memoryId: string; edgeId: string },
  ): void;

  /** Upsert root memory row; returns stable ids and creation timestamp field used by validators. */
  upsertMemory(
    op: MemoryOpContext,
    input: {
      namespace: NamespacePath;
      key: string;
      kind?: MemoryKind;
      /** Required when `kind` is `edge` after the graph edge exists. */
      edgeId?: string | null;
    },
  ): { memoryId: string; _ts_created: number };

  /**
   * Resolve graph association for a logical key (`undefined` if no memory row).
   * Node memories infer `nodeId`; edge memories require stored `edge_id`.
   */
  findMemoryAssociation(
    namespace: NamespacePath,
    key: string,
  ):
    | { memoryId: string; kind: "node"; nodeId: string }
    | { memoryId: string; kind: "edge"; edgeId: string }
    | undefined;

  /** Insert a source map row for (memoryId, sourceKey); content items are one map each. */
  insertSourceMap(
    op: MemoryOpContext,
    input: { memoryId: string; sourceKey: string },
  ): { sourceMapId: string };

  /** Attach searchable text for lexical retrieval on a source map. */
  insertLexicalFeature(
    op: MemoryOpContext,
    input: { memoryId: string; sourceMapId: string; text: string },
  ): { textFeatureId: string };

  /** Attach a vector feature and index it for vector search (dimension must match query embeddings). */
  insertVectorFeature(
    op: MemoryOpContext,
    input: { memoryId: string; sourceMapId: string; vector: Float32Array },
  ): { vectorFeatureId: string };

  /** Resolve memory primary key by logical key, or `undefined` if absent. */
  findMemoryIdByKey(namespace: NamespacePath, key: string): string | undefined;

  /** Whether a node row exists (used to validate edge targets). */
  nodeExists(nodeId: string): boolean;

  /**
   * Rebuild search-meta canonical text (and optional vector) for a memory key.
   * **Post:** Meta chunk participates in hybrid search when lexical/vector features exist.
   */
  syncMemorySearchMeta(
    op: MemoryOpContext,
    input: { namespace: NamespacePath; memoryKey: string; metaVector?: Float32Array },
  ): void;

  /**
   * Rebuild lexical label-property chunks for ontology props (node assignments + incident edges).
   * Optional: backends that only support topology meta may omit; the reference persistence implements this.
   */
  syncLabelPropsSearchFeatures?(
    op: MemoryOpContext,
    input: { namespace: NamespacePath; memoryKey: string },
  ): void;

  /** Build canonical meta text for a memory (read during sync). */
  buildCanonicalMemorySearchMetaText(
    op: MemoryOpContext,
    namespace: NamespacePath,
    memoryKey: string,
  ): string;

  /** Upsert vector for the search-meta source map only (batch path after merge). */
  upsertMemorySearchMetaVector(
    op: MemoryOpContext,
    input: { namespace: NamespacePath; memoryKey: string; vector: Float32Array },
  ): void;

  /**
   * Delete root rows after subtree clear.
   * **Node:** memory + primary node.
   * **Edge:** delete the graph `edges` row (CASCADE removes the memory row and features).
   */
  deleteMemoryRootRows(
    input:
      | { memoryKind: "node"; memoryId: string; nodeId: string }
      | { memoryKind: "edge"; edgeId: string },
  ): void;

  /** Latest provenance chain head (`root_hex`), or `undefined` if empty. */
  getProvenanceHeadRootHex(): string | undefined;

  /**
   * Append one provenance row advancing the linear chain. Must run inside {@link withTransaction}.
   * Stores canonical JSON of `event` in `memory_provenance.event_json`.
   * Returns the new chain head `root_hex`.
   */
  appendProvenanceEvent(op: MemoryOpContext, event: MemoryProvenanceEvent): { root_hex: string };

  /**
   * Write raw content to the append-only outbox so point-in-time reconstruction is possible.
   * Must be called inside the same transaction as {@link appendProvenanceEvent}, immediately after.
   * For `MERGE_MEMORY` pass one entry per user content item. For `DELETE_MEMORY` pass `entries: []`.
   * Omitting this method is valid (outbox stays empty); reconstruction will simply return no rows.
   */
  appendContentOutbox?(
    op: MemoryOpContext,
    input: {
      root_hex: string;
      event_type: "MERGE_MEMORY" | "DELETE_MEMORY";
      namespace: string;
      memoryKey: string;
      entries: ReadonlyArray<{ sourceKey: string; text?: string }>;
    },
  ): void;

  /**
   * Persist {@link computeSourceMapContentHash} for one source map row (merge transaction).
   */
  updateSourceMapContentHash(
    op: MemoryOpContext,
    input: { sourceMapId: string } & SourceMapBodyParts,
  ): void;

  /** Primary namespace + logical key for a memory row, if it exists. */
  loadMemoryNamespaceKey(memoryId: string): { namespace: NamespacePath; key: string } | undefined;

  /** Ensure a scope row exists (scope id = namespace-shaped path string). */
  upsertScope(op: MemoryOpContext, input: { scopeId: NamespacePath }): void;

  /** Add DAG edge parent → child; rejects cycles. Rebuilds scope closure. */
  linkScopes(
    op: MemoryOpContext,
    input: { parentScopeId: NamespacePath; childScopeId: NamespacePath },
  ): void;

  /** Remove one scope edge; rebuilds closure. */
  unlinkScopeEdge(
    op: MemoryOpContext,
    input: { parentScopeId: NamespacePath; childScopeId: NamespacePath },
  ): void;

  /** Replace all scope attachments for a memory (dedupe enforced by storage). */
  replaceMemoryScopes(
    op: MemoryOpContext,
    input: { memoryId: string; scopeIds: readonly NamespacePath[] },
  ): void;

  /** Distinct scope ids attached to this memory. */
  listScopesForMemory(memoryId: string): NamespacePath[];

  /**
   * Upsert display metadata for a namespace path (may exist before any memories).
   * Omit `displayName` to leave unchanged on update; pass `null` to clear (use key in UI).
   * Omit `description` to leave unchanged on update; default `""` on insert.
   */
  upsertNamespaceMetadata(
    op: MemoryOpContext,
    input: {
      namespace: NamespacePath;
      displayName?: string | null;
      description?: string;
    },
  ): void;

  /** Remove namespace metadata row; idempotent if missing. */
  deleteNamespaceMetadata(op: MemoryOpContext, namespace: NamespacePath): void;
}

/** Graph node/edge catalog writes (merge-time). Combined with {@link MemoriesGraphIndex} as {@link MemoriesGraph}. */
export interface MemoriesGraphMutation {
  /**
   * Neighboring memories linked by a graph edge to this node (any primary namespace).
   * Used when syncing search-meta across endpoints after merge.
   */
  listNeighborMemoriesForNode(
    op: MemoryOpContext,
    namespace: NamespacePath,
    nodeId: string,
  ): ReadonlyArray<{ namespace: NamespacePath; key: string }>;

  /** Upsert the primary graph node for a memory key; optional JSON properties on the node. */
  upsertNodeForMemoryKey(
    op: MemoryOpContext,
    input: {
      namespace: NamespacePath;
      memoryKey: string;
      memoryId: string;
      properties?: Record<string, unknown>;
    },
  ): { nodeId: string };

  /** Get or create a catalog row for a node label **kind**; optional JSON Schema text for assignment props. */
  ensureNodeLabel(
    op: MemoryOpContext,
    input: { kind: string; description?: string; schemaJson?: string | null },
  ): string;

  /** Assign props for one node label kind (upserts the single row per node + kind). */
  insertNodeLabelAssignment(
    op: MemoryOpContext,
    input: { nodeId: string; labelId: string; props: Record<string, unknown> },
  ): void;

  /** Insert a directed edge between two nodes; `idParts` encode deduplication identity. */
  insertEdge(
    op: MemoryOpContext,
    input: {
      fromNodeId: string;
      toNodeId: string;
      properties?: Record<string, unknown>;
      idParts: { label: string; fromMemoryId: string; toMemoryId: string };
    },
  ): { edgeId: string };

  ensureEdgeLabel(
    op: MemoryOpContext,
    input: { kind: string; description?: string; schemaJson?: string | null },
  ): string;

  insertEdgeLabelAssignment(
    op: MemoryOpContext,
    input: { edgeId: string; labelId: string; props: Record<string, unknown> },
  ): void;
}

/** Full merge/delete mutation surface: {@link MemoriesMutationCore} plus {@link MemoriesGraphMutation}. */
export type MemoriesMutation = MemoriesMutationCore & MemoriesGraphMutation;

/**
 * Lexical + vector retrieval and hydration for hybrid search.
 * Return lists are **rank-ordered** `source_map` ids (best first); scores are not supplied—RRF uses rank.
 */
export interface MemoriesRetrieval {
  searchLexicalSourceMapIds(input: {
    scope: SearchNamespaceScope;
    text: string;
    limit: number;
    memoryIds?: string[];
    /** Only memories with `_ts_created <= asOfTimestampMs` participate (backend-dependent). */
    asOfTimestampMs?: number;
  }): string[];

  searchVectorSourceMapIds(input: {
    scope: SearchNamespaceScope;
    vector: number[];
    limit: number;
    memoryIds?: string[];
    /** Distance upper bound; omit = return top‑k without a distance cutoff. */
    maxVectorDistance?: number;
    /** Only memories with `_ts_created <= asOfTimestampMs` participate (backend-dependent). */
    asOfTimestampMs?: number;
    /** Resolved method from core; unsupported → empty `sourceMapIds`. */
    method: VectorSearchMethod;
  }): SearchVectorSourceMapIdsResult;

  hydrateSourceMapHits(sourceMapIds: readonly string[]): HydratedSourceMapHit[];
}

/** Graph neighbor listing for search expansion and filters. */
export interface MemoriesNeighborIndex {
  listNeighborsForMemory<
    EDGE_LABEL extends string = string,
    NODE_LABEL extends string = string,
  >(input: {
    namespace: NamespacePath;
    key: string;
    filters?: NeighborFilter<EDGE_LABEL, NODE_LABEL>;
  }): HydratedNeighbor[];

  /** Endpoint node memories for a graph edge (for neighbor expansion when the search root is an edge memory). */
  listNeighborsForEdgeMemory<
    EDGE_LABEL extends string = string,
    NODE_LABEL extends string = string,
  >(input: {
    namespace: NamespacePath;
    edgeId: string;
    filters?: NeighborFilter<EDGE_LABEL, NODE_LABEL>;
  }): HydratedNeighbor[];
}

/**
 * Prefetch / export reads (aligned with Smithy persistence ops).
 * {@link listVectorEmbeddingIndexDimensions} returns `[]` when the store cannot infer dimensions (unknown or not applicable).
 */
export interface MemoriesPersistenceReads {
  /** All distinct primary memory namespaces, sorted for stable UI. */
  listMemoryNamespaces(): NamespacePath[];

  /**
   * Union of namespaces that have memories and/or metadata rows, sorted by path.
   * Memory-only keys appear with `displayName: null` and empty `description`.
   */
  listNamespacesWithMetadata(): NamespaceMetadataInfo[];

  /** Metadata row for one namespace, or `undefined` if none. */
  getNamespaceMetadata(namespace: NamespacePath): NamespaceMetadataInfo | undefined;

  /** Memory keys in one primary namespace (unordered). */
  listMemoryKeysInNamespace(namespace: NamespacePath): string[];

  /** Source map rows for a memory, newest first, capped at `limit`. */
  listSourceMapsForMemory(memoryId: string, limit: number): SourceMap[];

  /** Text lines joined with source keys for JSONL sync and similar export paths. */
  listTextFeatureExportRowsForMemory(memoryId: string): TextFeatureExportRow[];

  /** Display text attached to one source map row, truncated to `maxChars` when supplied. */
  getSourceMapTextPreview(sourceMapId: string, maxChars?: number): string | null;

  /**
   * Distinct embedding widths present in the store's vector indexes (one entry per width in use).
   * Return `[]` when there are no indexed vectors or dimension metadata is unavailable.
   */
  listVectorEmbeddingIndexDimensions(): number[];

  /** Timestamp (`memory_provenance._ts_created`) for a chain link `root_hex`, when known. */
  getProvenanceTimestampMsForRootHex?(rootHex: string): number | undefined;
}

/**
 * Graph topology reads (optional module; gate with {@link MemoriesBackendCapabilities.graphIndex}).
 * Prefer per-entity methods when querying a single key or edge id; use namespace-wide loaders for bulk.
 * UMAP / text previews / embedding means for layout live in SQLite-only visualization helpers, not here.
 */
export interface MemoriesGraphIndex {
  /** All edges whose endpoints are memories in `namespace` (see storage docs for direction semantics). */
  loadGraphEdgesForNamespace(namespace: NamespacePath): GraphEdgeLink[];

  loadNodeLabelsForNamespace(namespace: NamespacePath): Map<string, OntologyLabelInstance[]>;

  /** Node JSON properties from stored graph nodes (null when absent or empty). */
  loadNodePropertiesForNamespace(
    namespace: NamespacePath,
  ): Map<string, Record<string, unknown> | null>;

  /** Edges incident to the memory key (either endpoint matches). */
  listIncidentGraphEdges(namespace: NamespacePath, memoryKey: string): GraphEdgeLink[];

  /** Ontology labels for one memory’s node; `[]` if none or unknown key. */
  loadNodeLabelsForMemory(namespace: NamespacePath, memoryKey: string): OntologyLabelInstance[];

  /** Parsed JSON from `nodes.properties`; `null` if absent, empty, or unknown memory key. */
  loadNodePropertiesForMemory(
    namespace: NamespacePath,
    memoryKey: string,
  ): Record<string, unknown> | null;

  /** One edge by id; `null` if missing or endpoints are not both in `namespace`. */
  loadGraphEdge(namespace: NamespacePath, edgeId: string): GraphEdgeLink | null;

  /**
   * Full graph node for one memory (labels + properties + ids). Preferred over separate
   * `loadNodeLabelsForMemory` / `loadNodePropertiesForMemory` when you need the whole node.
   * `null` if no memory row exists for `memoryKey` in `namespace`.
   */
  loadGraphNode(namespace: NamespacePath, memoryKey: string): GraphNode | null;
}

/** Graph topology reads + graph writes ({@link MemoriesGraphIndex} & {@link MemoriesGraphMutation}). */
export type MemoriesGraph = MemoriesGraphIndex & MemoriesGraphMutation;

/**
 * Core storage: {@link MemoriesMutationCore} + {@link MemoriesRetrieval} + {@link MemoriesNeighborIndex} + {@link MemoriesPersistenceReads} + {@link MemoriesGraph}.
 * Equivalent to {@link MemoriesMutation} & … & {@link MemoriesGraphIndex} (same flat method set as before).
 * Optional {@link MemoriesBackendCapabilities} declares MVP subsets.
 */
export type MemoriesPersistence = MemoriesMutationCore &
  MemoriesRetrieval &
  MemoriesNeighborIndex &
  MemoriesPersistenceReads &
  MemoriesGraph & {
    capabilities?: MemoriesBackendCapabilities;
  };

/** Core persistence passed to merge / search / delete APIs. */
export type MemoriesRuntimeCtx = { persistence: MemoriesPersistence };
