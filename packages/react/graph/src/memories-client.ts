import type {
  MemoriesGraphNamespaceEntry,
  MemoriesGraphNamespacesPayload,
} from "./lib/namespace-entries.js";
import type { GraphPayload } from "./projection-types.js";

export type { MemoriesDatabaseId } from "./memories-database-id.js";
export { memoriesDatabaseKey } from "./memories-database-id.js";

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
  content: Array<{ sourceKey: string; text: string | null }>;
  /** Freeform JSON from `nodes.properties` (not ontology label props). */
  properties: Record<string, unknown> | null;
  suppressed: boolean;
};

/** Wire result from {@link ReactMemoriesClient.search} (before chrome maps to search state). */
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

/** Arm weights for {@link ReactMemoriesClient.searchNamespaces}. */
export type NamespaceSearchArms = {
  nodes?: number;
  lexical?: number;
  vector?: number;
};

/** Ranked namespace hit from {@link ReactMemoriesClient.searchNamespaces}. */
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

/** Result from {@link ReactMemoriesClient.searchNamespaces}. */
export type NamespaceSearchClientResult = {
  query: string;
  under: string | null;
  namespaces: NamespaceSearchHitResult[];
};

/**
 * Host graph backend contract for React graph UI.
 *
 * Browser hosts typically implement this over a BFF. Node/server hosts may use
 * {@link createServiceReactMemoriesClient} from `@khoralabs/memories-react-graph/service`.
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

  /**
   * Rank namespaces via arms-driven search (`POST /databases/search-namespaces`).
   * @see NamespaceSearchArms
   */
  searchNamespaces(input: {
    query: string;
    namespace?: string;
    under?: string;
    limit?: number;
    nodeTopK?: number;
    arms?: NamespaceSearchArms;
    /** Optional query embedding (512–3072 floats); required when arms.vector > 0. */
    vector?: number[];
    includeSuppressed?: boolean;
    signal?: AbortSignal;
  }): Promise<NamespaceSearchClientResult>;

  getEdgePreview(input: {
    namespace: string;
    edgeId: string;
    includeSuppressed?: boolean;
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

  deleteMemory(input: { namespace: string; key: string; signal?: AbortSignal }): Promise<void>;

  getMemoryPreview(input: {
    namespace: string;
    key: string;
    maxChars?: number;
    signal?: AbortSignal;
  }): Promise<MemoryPreviewJson>;
};
