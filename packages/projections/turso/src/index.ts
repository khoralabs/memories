import type { MemoriesPersistenceAsync } from "@khoralabs/memories-core";
import {
  buildNamespaceGraphLayoutFromSource,
  buildNamespaceSubtreeGraphLayoutFromSource,
  createMemoriesVisualizationFromSource,
  type Umap3DLayoutOptions,
} from "@khoralabs/memories-projections";
import { createTursoGraphProjectionSource, type TursoProjectionQueryClient } from "./source";

export {
  buildNamespaceGraphLayoutFromSource,
  buildNamespaceSubtreeGraphLayoutFromSource,
  createMemoriesVisualizationFromSource,
  createSeededRandom,
  DEFAULT_UMAP_LAYOUT_SEED,
  fibonacciSphereLayout3D,
  type GraphLayoutEdge,
  type GraphLayoutNode,
  type GraphProjectionSource,
  LABEL_PROPERTY_SYNTH_DIM,
  labelPropertySyntheticEmbedding,
  minMaxNormalize3D,
  type NamespaceGraphLayout,
  type Point3,
  QUALIFIED_MEMORY_KEY_SEP,
  qualifyMemoryKey,
  type Umap3DLayoutOptions,
  umap3DLayout,
} from "@khoralabs/memories-projections";
export {
  createTursoGraphProjectionSource,
  listNamespacesUnderPrefix,
  loadMeanEmbeddingsForNamespace,
  loadMemoryTextPreview,
  loadSourceMapTextPreview,
  type TursoProjectionQueryClient,
  type TursoProjectionQueryResult,
  type TursoProjectionRow,
} from "./source";

export function buildNamespaceGraphLayout(
  queryClient: TursoProjectionQueryClient,
  persistence: Pick<
    MemoriesPersistenceAsync,
    "loadGraphEdgesForNamespace" | "loadNodeLabelsForNamespace" | "loadNodePropertiesForNamespace"
  >,
  namespace: string,
  options?: Umap3DLayoutOptions,
) {
  return buildNamespaceGraphLayoutFromSource(
    createTursoGraphProjectionSource(queryClient),
    persistence,
    namespace,
    options,
  );
}

export function buildNamespaceSubtreeGraphLayout(
  queryClient: TursoProjectionQueryClient,
  persistence: Pick<
    MemoriesPersistenceAsync,
    "loadGraphEdgesForNamespace" | "loadNodeLabelsForNamespace" | "loadNodePropertiesForNamespace"
  >,
  prefix: string,
  options?: Umap3DLayoutOptions,
) {
  return buildNamespaceSubtreeGraphLayoutFromSource(
    createTursoGraphProjectionSource(queryClient),
    persistence,
    prefix,
    options,
  );
}

export function createTursoMemoriesVisualization(
  queryClient: TursoProjectionQueryClient,
  persistence: Pick<
    MemoriesPersistenceAsync,
    | "loadGraphEdgesForNamespace"
    | "loadNodeLabelsForNamespace"
    | "loadNodePropertiesForNamespace"
    | "loadGraphEdge"
  >,
) {
  return createMemoriesVisualizationFromSource(
    createTursoGraphProjectionSource(queryClient),
    persistence,
  );
}
