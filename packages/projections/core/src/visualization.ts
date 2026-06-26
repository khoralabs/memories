import type { MemoriesPersistenceAsync } from "@khoralabs/memories-core";
import { buildNamespaceGraphLayoutFromSource } from "./graph/build-namespace-graph-layout";
import { buildNamespaceSubtreeGraphLayoutFromSource } from "./graph/build-namespace-subtree-graph-layout";
import type { NamespaceGraphLayout } from "./graph/layout-types";
import type { Umap3DLayoutOptions } from "./graph/umap-layout";
import type { GraphProjectionSource } from "./source";
import { loadEdgePreviewFromPersistence } from "./source";

export type MemoriesVisualizationFromSource = {
  buildNamespaceGraphLayout(
    namespace: string,
    options?: Umap3DLayoutOptions,
  ): Promise<NamespaceGraphLayout>;
  buildNamespaceSubtreeGraphLayout(
    prefix: string,
    options?: Umap3DLayoutOptions,
  ): Promise<NamespaceGraphLayout>;
  loadMemoryTextPreview(namespace: string, key: string, maxChars?: number): Promise<string | null>;
  loadSourceMapTextPreview(sourceMapId: string, maxChars?: number): Promise<string | null>;
  loadEdgePreview(
    namespace: string,
    edgeId: string,
  ): ReturnType<typeof loadEdgePreviewFromPersistence>;
};

export function createMemoriesVisualizationFromSource(
  source: GraphProjectionSource,
  persistence: Pick<
    MemoriesPersistenceAsync,
    | "loadGraphEdgesForNamespace"
    | "loadNodeLabelsForNamespace"
    | "loadNodePropertiesForNamespace"
    | "loadGraphEdge"
  >,
): MemoriesVisualizationFromSource {
  return {
    buildNamespaceGraphLayout(namespace, options) {
      return buildNamespaceGraphLayoutFromSource(source, persistence, namespace, options);
    },
    buildNamespaceSubtreeGraphLayout(prefix, options) {
      return buildNamespaceSubtreeGraphLayoutFromSource(source, persistence, prefix, options);
    },
    loadMemoryTextPreview(namespace, key, maxChars) {
      return source.loadMemoryTextPreview(namespace, key, maxChars);
    },
    loadSourceMapTextPreview(sourceMapId, maxChars) {
      return source.loadSourceMapTextPreview(sourceMapId, maxChars);
    },
    loadEdgePreview(namespace, edgeId) {
      return loadEdgePreviewFromPersistence(persistence, namespace, edgeId);
    },
  };
}
