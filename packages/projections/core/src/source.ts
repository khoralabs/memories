import type {
  EdgePreviewPayload,
  GraphEdgeLink,
  GraphMemoryEmbedding,
  OntologyLabelInstance,
} from "@khoralabs/memories-core";

export type MaybePromise<T> = T | Promise<T>;

export type GraphProjectionSource = {
  listNamespacesUnderPrefix(prefix: string): Promise<string[]>;
  loadMeanEmbeddingsForNamespace(namespace: string): Promise<GraphMemoryEmbedding[]>;
  loadMemoryTextPreview(namespace: string, key: string, maxChars?: number): Promise<string | null>;
  loadSourceMapTextPreview(sourceMapId: string, maxChars?: number): Promise<string | null>;
};

export type GraphProjectionGraphReads = {
  loadGraphEdgesForNamespace(namespace: string): MaybePromise<GraphEdgeLink[]>;
  loadNodeLabelsForNamespace(namespace: string): MaybePromise<Map<string, OntologyLabelInstance[]>>;
  loadNodePropertiesForNamespace(
    namespace: string,
  ): MaybePromise<Map<string, Record<string, unknown> | null>>;
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
