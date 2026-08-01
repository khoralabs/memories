import type {
  EdgePreviewPayload,
  GraphEdgeLink,
  GraphMemoryEmbedding,
  IncludeSuppressedOpts,
  MemoriesPersistenceAsync,
  OntologyLabelInstance,
} from "../persistence/core";

export type MaybePromise<T> = T | Promise<T>;

export type GraphProjectionSource = {
  listNamespacesUnderPrefix(prefix: string, opts?: IncludeSuppressedOpts): Promise<string[]>;
  loadMeanEmbeddingsForNamespace(
    namespace: string,
    opts?: IncludeSuppressedOpts,
  ): Promise<GraphMemoryEmbedding[]>;
  loadMemoryTextPreview(namespace: string, key: string, maxChars?: number): Promise<string | null>;
  loadSourceMapTextPreview(sourceMapId: string, maxChars?: number): Promise<string | null>;
};

export type GraphProjectionGraphReads = {
  loadGraphEdgesForNamespace(
    namespace: string,
    opts?: IncludeSuppressedOpts,
  ): MaybePromise<GraphEdgeLink[]>;
  loadNodeLabelsForNamespace(
    namespace: string,
    opts?: IncludeSuppressedOpts,
  ): MaybePromise<Map<string, OntologyLabelInstance[]>>;
  loadNodePropertiesForNamespace(
    namespace: string,
    opts?: IncludeSuppressedOpts,
  ): MaybePromise<Map<string, Record<string, unknown> | null>>;
  listSuppressedNodeKeysForNamespace(namespace: string): MaybePromise<string[]>;
  isNamespaceSuppressed(namespace: string): MaybePromise<boolean>;
};

export type EdgePreviewReads = {
  loadGraphEdge(namespace: string, edgeId: string): MaybePromise<GraphEdgeLink | null>;
};

/** Topology + edge preview reads used by visualization helpers. */
export type GraphProjectionPersistenceReads = GraphProjectionGraphReads & EdgePreviewReads;

/** Strip `Promise` from port method return types for sync (bun:sqlite) helpers. */
type SyncifyMethods<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => MaybePromise<infer R>
    ? (...args: A) => R
    : T[K];
};

/** Sync {@link GraphProjectionGraphReads} for bun:sqlite layout helpers. */
export type SyncGraphProjectionGraphReads = SyncifyMethods<GraphProjectionGraphReads>;

/** Sync {@link EdgePreviewReads} for bun:sqlite edge-preview helpers. */
export type SyncEdgePreviewReads = SyncifyMethods<EdgePreviewReads>;

/**
 * Compile-time guard: resolves to `true` only while {@link MemoriesPersistenceAsync}
 * remains assignable to {@link GraphProjectionPersistenceReads}.
 */
export type AssertMemoriesPersistenceAsyncImplementsProjectionReads =
  MemoriesPersistenceAsync extends GraphProjectionPersistenceReads ? true : never;

const _assertMemoriesPersistenceAsyncImplementsProjectionReads: AssertMemoriesPersistenceAsyncImplementsProjectionReads = true;
void _assertMemoriesPersistenceAsyncImplementsProjectionReads;

export async function loadEdgePreviewFromPersistence(
  persistence: EdgePreviewReads,
  namespace: string,
  edgeId: string,
): Promise<EdgePreviewPayload | null> {
  const link = await persistence.loadGraphEdge(namespace, edgeId);
  if (!link) return null;
  return {
    edgeId: link.edgeId,
    fromKey: link.fromKey,
    toKey: link.toKey,
    labels: link.labels,
    properties: link.properties ?? null,
  };
}
