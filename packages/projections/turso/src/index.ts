import type { MemoriesPersistenceAsync } from "@khoralabs/memories-core";
import {
  buildNamespaceGraphLayoutFromSource,
  buildNamespaceSubtreeGraphLayoutFromSource,
  collectNamespaceSubtreeUmapInput,
  collectNamespaceUmapInput,
  createMemoriesVisualizationFromSource,
  type NamespaceUmapInput,
  type Umap3DLayoutOptions,
} from "@khoralabs/memories-projections";
import { createTursoGraphProjectionSource, type TursoProjectionQueryClient } from "./source";

export {
  buildNamespaceGraphLayoutFromSource,
  buildNamespaceGraphLayoutFromUmapInput,
  buildNamespaceSubtreeGraphLayoutFromSource,
  collectNamespaceSubtreeUmapInput,
  collectNamespaceUmapInput,
  createMemoriesVisualizationFromSource,
  createSeededRandom,
  DEFAULT_UMAP_LAYOUT_SEED,
  decodeUmapInput,
  encodeUmapInput,
  fibonacciSphereLayout3D,
  type GraphLayoutEdge,
  type GraphLayoutNode,
  type GraphProjectionSource,
  LABEL_PROPERTY_SYNTH_DIM,
  labelPropertySyntheticEmbedding,
  minMaxNormalize3D,
  type NamespaceGraphLayout,
  type NamespaceUmapInput,
  type Point3,
  QUALIFIED_MEMORY_KEY_SEP,
  qualifyMemoryKey,
  UMAP_INPUT_CONTENT_TYPE,
  UMAP_INPUT_ENCODING_HEADER,
  UMAP_INPUT_VERSION,
  type Umap3DLayoutOptions,
  umap3DLayout,
  validateUmapInput,
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

export type CollectTursoUmapInputOptions = {
  namespace: string;
  scope?: "exact" | "subtree";
  provenanceHeadRootHex?: string;
};

export function collectTursoUmapInput(
  queryClient: TursoProjectionQueryClient,
  persistence: Pick<
    MemoriesPersistenceAsync,
    "loadGraphEdgesForNamespace" | "loadNodeLabelsForNamespace" | "loadNodePropertiesForNamespace"
  >,
  input: CollectTursoUmapInputOptions,
): Promise<NamespaceUmapInput> {
  const source = createTursoGraphProjectionSource(queryClient);
  const options = { provenanceHeadRootHex: input.provenanceHeadRootHex };
  if (input.scope === "subtree") {
    return collectNamespaceSubtreeUmapInput(source, persistence, input.namespace, options);
  }
  return collectNamespaceUmapInput(source, persistence, input.namespace, options);
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
