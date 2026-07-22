import type { MemoriesPersistenceAsync } from "../../../persistence/core";
import {
  buildNamespaceGraphLayoutFromSource,
  buildNamespaceSubtreeGraphLayoutFromSource,
  collectNamespaceUmapInput,
  createMemoriesVisualizationFromSource,
  type NamespaceUmapInput,
  type Umap3DLayoutOptions,
} from "../../../projections/index";
import { createLibsqlGraphProjectionSource, type LibsqlProjectionQueryClient } from "./source";

export {
  buildNamespaceGraphLayoutFromSource,
  buildNamespaceGraphLayoutFromUmapInput,
  buildNamespaceSubtreeGraphLayoutFromSource,
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
} from "../../../projections/index";
export {
  createLibsqlGraphProjectionSource,
  type LibsqlProjectionQueryClient,
  type LibsqlProjectionQueryResult,
  type LibsqlProjectionRow,
  listNamespacesUnderPrefix,
  loadMeanEmbeddingsForNamespace,
  loadMemoryTextPreview,
  loadSourceMapTextPreview,
} from "./source";

export function buildNamespaceGraphLayout(
  queryClient: LibsqlProjectionQueryClient,
  persistence: Pick<
    MemoriesPersistenceAsync,
    "loadGraphEdgesForNamespace" | "loadNodeLabelsForNamespace" | "loadNodePropertiesForNamespace"
  >,
  namespace: string,
  options?: Umap3DLayoutOptions,
) {
  return buildNamespaceGraphLayoutFromSource(
    createLibsqlGraphProjectionSource(queryClient),
    persistence,
    namespace,
    options,
  );
}

export function buildNamespaceSubtreeGraphLayout(
  queryClient: LibsqlProjectionQueryClient,
  persistence: Pick<
    MemoriesPersistenceAsync,
    "loadGraphEdgesForNamespace" | "loadNodeLabelsForNamespace" | "loadNodePropertiesForNamespace"
  >,
  prefix: string,
  options?: Umap3DLayoutOptions,
) {
  return buildNamespaceSubtreeGraphLayoutFromSource(
    createLibsqlGraphProjectionSource(queryClient),
    persistence,
    prefix,
    options,
  );
}

export type CollectLibsqlUmapInputOptions = {
  namespace: string;
  scope?: "exact" | "subtree";
  provenanceHeadRootHex?: string;
};

export function collectLibsqlUmapInput(
  queryClient: LibsqlProjectionQueryClient,
  persistence: Pick<
    MemoriesPersistenceAsync,
    "loadGraphEdgesForNamespace" | "loadNodeLabelsForNamespace" | "loadNodePropertiesForNamespace"
  >,
  input: CollectLibsqlUmapInputOptions,
): Promise<NamespaceUmapInput> {
  const source = createLibsqlGraphProjectionSource(queryClient);
  return collectNamespaceUmapInput(source, persistence, input.namespace, {
    provenanceHeadRootHex: input.provenanceHeadRootHex,
    scope: input.scope,
  });
}

export function createLibsqlMemoriesVisualization(
  queryClient: LibsqlProjectionQueryClient,
  persistence: Pick<
    MemoriesPersistenceAsync,
    | "loadGraphEdgesForNamespace"
    | "loadNodeLabelsForNamespace"
    | "loadNodePropertiesForNamespace"
    | "loadGraphEdge"
  >,
) {
  return createMemoriesVisualizationFromSource(
    createLibsqlGraphProjectionSource(queryClient),
    persistence,
  );
}
