/**
 * Thin port for React / host UI layers.
 * Browser hosts implement {@link ReactMemoriesClient} over a BFF.
 * Node/server hosts may use {@link createServiceReactMemoriesClient} from
 * `@khoralabs/memories-service/react-client/service`.
 */

/** Database address used by graph providers (mirrors service wire id). */
export type MemoriesDatabaseId = {
  kind: string;
  ownerKey: string;
};

/** Stable string key for React provider memoization (not storage `databaseKey`). */
export function memoriesDatabaseKey(id: MemoriesDatabaseId): string {
  return `${id.kind}:${id.ownerKey}`;
}

/** Namespace catalog row from host listNamespaces. */
export type MemoriesGraphNamespaceEntry = {
  namespace: string;
  alias: string | null;
  description: string;
  suppressed: boolean;
};

export type MemoriesGraphNamespaceEntryInput = Omit<MemoriesGraphNamespaceEntry, "suppressed"> & {
  suppressed?: boolean;
};

export type MemoriesGraphNamespacesPayload = {
  namespaces?: Array<MemoriesGraphNamespaceEntryInput>;
  profiles?: Array<{
    profileId: string;
    username?: string;
    namespace: string;
    indexed: boolean;
  }>;
  namespaceRoot?: string;
  error?: string;
};

export type GraphLabelInstance = {
  kind: string;
  props: Record<string, unknown>;
};

export type GraphNodeDegree = {
  count: number;
  centrality: number;
};

/** Layout wire shape from getGraph. */
export type GraphPayload = {
  namespace: string;
  nodes: Array<{
    key: string;
    x: number;
    y: number;
    z: number;
    labels: GraphLabelInstance[];
    degree: GraphNodeDegree;
    suppressed: boolean;
  }>;
  edges: Array<{
    edgeId: string;
    fromKey: string;
    toKey: string;
    labels: GraphLabelInstance[];
    directed?: boolean;
    suppressed: boolean;
  }>;
};

export type EdgePreviewJson = {
  edgeId?: string;
  fromKey?: string;
  toKey?: string;
  labels?: Array<{ kind: string; props: Record<string, unknown> }>;
  properties?: Record<string, unknown> | null;
  suppressed?: boolean;
  error?: string;
};

/** Wire result from {@link ReactMemoriesClient.getMemoryPreview}. */
export type MemoryPreviewJson = {
  key: string;
  namespace: string;
  labels: Array<{ kind: string; props: Record<string, unknown> }>;
  content: Array<{
    sourceKey: string;
    sourceMapId: string;
    text: string | null;
    hasText: boolean;
    hasVector: boolean;
    contentHash?: string;
    createdAt: number;
  }>;
  properties: Record<string, unknown> | null;
  suppressed: boolean;
  atTip?: TipAtRootJson;
};

export type TipAtRootJson = {
  content: { rootHex: string; content: Array<{ sourceKey: string; text: string }> } | null;
  graph: { rootHex: string; graph: Record<string, unknown> | null } | null;
  vectors: {
    rootHex: string;
    vectors: Array<{ sourceKey: string; dimensions: number; values?: number[] }>;
  } | null;
};

export type MemoryDetailJson = {
  rootHex?: string;
  preview: MemoryPreviewJson;
  atTip: TipAtRootJson;
  events: {
    events: Array<{
      id: string;
      rootHex: string;
      parentRootHex: string;
      eventType: string;
      createdAt: number;
      event: Record<string, unknown>;
      intentSnapshotId?: string;
    }>;
    nextBefore?: { createdAt: number; id: string };
  };
};

export type EdgeDetailJson = {
  rootHex?: string;
  preview: EdgePreviewJson & { edgeId: string; fromKey: string; toKey: string };
  atTip: TipAtRootJson;
  events: MemoryDetailJson["events"];
};

export type GraphSearchResult = {
  hitCount: number;
  hitKeys?: string[];
  neighborKeys?: string[];
  keys: string[];
  hitSnippets: Array<{ key: string; sourceKey?: string; text: string | null }>;
  edgeHitSnippets: Array<{
    edgeId: string;
    fromKey?: string;
    toKey?: string;
    text: string | null;
  }>;
};

export type NamespaceSearchArms = {
  nodes?: number;
  lexical?: number;
  vector?: number;
};

export type NamespaceSearchHitResult = {
  namespace: string;
  lineage: string[];
  score: number;
  hitCount: number;
  scoreSum: number;
  scoreMax: number;
  topHits: Array<{ memory_key: string; score: number; kind: "node" | "edge" }>;
  suppressed: boolean;
};

export type NamespaceSearchClientResult = {
  query: string;
  under: string | null;
  namespaces: NamespaceSearchHitResult[];
};

export type GraphCountsResult = {
  namespace: string;
  scope: "exact" | "subtree";
  nodeCount: number;
  edgeCount: number;
};

export type GraphStatsResult = GraphCountsResult & {
  suppressedNodeCount: number;
  suppressedEdgeCount: number;
  labelKinds: {
    nodes: Record<string, number>;
    edges: Record<string, number>;
  };
};

/**
 * Host graph backend contract for React graph UI.
 *
 * Browser hosts typically implement this over a BFF. Node/server hosts may use
 * {@link createServiceReactMemoriesClient} from
 * `@khoralabs/memories-service/react-client/service`.
 */
export type ReactMemoriesClient = {
  listNamespaces(opts?: {
    signal?: AbortSignal;
    includeSuppressed?: boolean;
  }): Promise<MemoriesGraphNamespacesPayload>;

  getGraph(input: {
    namespace: string;
    scope?: "exact" | "subtree";
    includeSuppressed?: boolean;
    signal?: AbortSignal;
  }): Promise<GraphPayload>;

  getGraphCounts(input: {
    namespace: string;
    scope?: "exact" | "subtree";
    includeSuppressed?: boolean;
    signal?: AbortSignal;
  }): Promise<GraphCountsResult>;

  getGraphStats(input: {
    namespace: string;
    scope?: "exact" | "subtree";
    includeSuppressed?: boolean;
    signal?: AbortSignal;
  }): Promise<GraphStatsResult>;

  search(input: {
    namespace: string;
    query: string;
    topK?: number;
    maxNeighbors?: number;
    maxVectorDistance?: number;
    scope?: "exact" | "subtree";
    includeSuppressed?: boolean;
    signal?: AbortSignal;
  }): Promise<GraphSearchResult>;

  searchNamespaces(input: {
    query: string;
    namespace?: string;
    under?: string;
    limit?: number;
    nodeTopK?: number;
    arms?: NamespaceSearchArms;
    vector?: number[];
    includeSuppressed?: boolean;
    signal?: AbortSignal;
  }): Promise<NamespaceSearchClientResult>;

  getEdgePreview(input: {
    namespace: string;
    edgeId: string;
    includeSuppressed?: boolean;
    rootHex?: string;
    includeAtTip?: boolean;
    includeVectors?: boolean;
    signal?: AbortSignal;
  }): Promise<EdgePreviewJson>;

  upsertNamespace(input: {
    namespace: string;
    alias?: string | null;
    description?: string;
    signal?: AbortSignal;
  }): Promise<MemoriesGraphNamespaceEntry>;

  getNamespaceMetadata(input: {
    namespace: string;
    signal?: AbortSignal;
  }): Promise<MemoriesGraphNamespaceEntry | null>;

  renameNamespace(input: {
    from: string;
    to: string;
    recursive?: boolean;
    signal?: AbortSignal;
  }): Promise<{ namespaces: Array<{ from: string; to: string }>; renamedMemories: number }>;

  deleteNamespace(input: {
    namespace: string;
    recursive?: boolean;
    signal?: AbortSignal;
  }): Promise<{ namespaces: string[]; deletedMemories: number }>;

  suppressNamespace(input: {
    namespace: string;
    intentSnapshotId?: string;
    signal?: AbortSignal;
  }): Promise<void>;

  unsuppressNamespace(input: {
    namespace: string;
    intentSnapshotId?: string;
    signal?: AbortSignal;
  }): Promise<void>;

  mergeMemory(input: {
    params: Record<string, unknown>;
    intentSnapshotId?: string;
    signal?: AbortSignal;
  }): Promise<{ memoryIds: string[] }>;

  replaceFeature(input: {
    namespace: string;
    key: string;
    sourceKey: string;
    text?: string;
    vector?: number[];
    intentSnapshotId?: string;
    signal?: AbortSignal;
  }): Promise<{ sourceMapId: string; rootHex: string }>;

  deleteMemory(input: { namespace: string; key: string; signal?: AbortSignal }): Promise<void>;

  getMemoryPreview(input: {
    namespace: string;
    key: string;
    maxChars?: number;
    rootHex?: string;
    includeAtTip?: boolean;
    includeVectors?: boolean;
    signal?: AbortSignal;
  }): Promise<MemoryPreviewJson>;

  getMemoryDetail(input: {
    namespace: string;
    key: string;
    rootHex?: string;
    limit?: number;
    before?: { createdAt: number; id: string };
    includeVectors?: boolean;
    maxChars?: number;
    signal?: AbortSignal;
  }): Promise<MemoryDetailJson>;

  getEdgeDetail(input: {
    namespace: string;
    edgeId: string;
    rootHex?: string;
    limit?: number;
    before?: { createdAt: number; id: string };
    includeVectors?: boolean;
    includeSuppressed?: boolean;
    signal?: AbortSignal;
  }): Promise<EdgeDetailJson>;

  getProvenanceGraph(input: {
    rootHex: string;
    namespace: string;
    key: string;
    signal?: AbortSignal;
  }): Promise<{ rootHex: string; graph: Record<string, unknown> | null }>;

  getProvenanceVectors(input: {
    rootHex: string;
    namespace: string;
    key: string;
    includeValues?: boolean;
    signal?: AbortSignal;
  }): Promise<{
    rootHex: string;
    vectors: Array<{ sourceKey: string; dimensions: number; values?: number[] }>;
  }>;

  getBackendCapabilities(input?: {
    signal?: AbortSignal;
  }): Promise<Record<string, boolean | undefined>>;

  getSourceMapText(input: { sourceMapId: string; signal?: AbortSignal }): Promise<string | null>;

  listProvenanceEvents(input: {
    namespace?: string;
    key?: string;
    edgeId?: string;
    limit?: number;
    before?: { createdAt: number; id: string };
    signal?: AbortSignal;
  }): Promise<
    Array<{
      id: string;
      rootHex: string;
      parentRootHex: string;
      eventType: string;
      createdAt: number;
      event: Record<string, unknown>;
      intentSnapshotId?: string;
    }>
  >;

  listProvenanceChain(input: {
    limit?: number;
    beforeRootHex?: string;
    signal?: AbortSignal;
  }): Promise<
    Array<{
      rootHex: string;
      parentRootHex: string;
      eventType: string;
      createdAt: number;
      id: string;
    }>
  >;

  getMemoryContentAtRootHex(input: {
    rootHex: string;
    namespace: string;
    key: string;
    signal?: AbortSignal;
  }): Promise<Array<{ sourceKey: string; text: string }>>;
};
