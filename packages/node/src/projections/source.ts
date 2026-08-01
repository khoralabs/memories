import type {
  EdgePreviewPayload,
  GraphEdgeLink,
  GraphMemoryEmbedding,
  IncludeSuppressedOpts,
  OntologyLabelInstance,
} from "../persistence/core";

export type MaybePromise<T> = T | Promise<T>;

export type GraphProjectionSource = {
  listNamespacesUnderPrefix(prefix: string): Promise<string[]>;
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
};

export type EdgePreviewReads = {
  loadGraphEdge(namespace: string, edgeId: string): MaybePromise<GraphEdgeLink | null>;
};

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
