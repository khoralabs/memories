import {
  buildNamespaceGraphLayoutFromSource,
  buildNamespaceSubtreeGraphLayoutFromSource,
  collectNamespaceProjectionInput,
  createMemoriesVisualizationFromSource,
  type GraphProjectionGraphReads,
  type GraphProjectionPersistenceReads,
  type NamespaceProjectionInput,
  type Umap3DLayoutOptions,
} from "../../../projections/index";
import { createLibsqlGraphProjectionSource, type LibsqlProjectionQueryClient } from "./source";

export {
  buildNamespaceGraphLayoutFromProjectionInput,
  buildNamespaceGraphLayoutFromSource,
  buildNamespaceSubtreeGraphLayoutFromSource,
  collectNamespaceProjectionInput,
  createMemoriesVisualizationFromSource,
  createSeededRandom,
  DEFAULT_UMAP_LAYOUT_SEED,
  decodeProjectionInput,
  encodeProjectionInput,
  fibonacciSphereLayout3D,
  type GraphLayoutEdge,
  type GraphLayoutNode,
  type GraphProjectionSource,
  LABEL_PROPERTY_SYNTH_DIM,
  labelPropertySyntheticEmbedding,
  minMaxNormalize3D,
  type NamespaceGraphLayout,
  type NamespaceProjectionInput,
  type Point3,
  PROJECTION_INPUT_CONTENT_TYPE,
  PROJECTION_INPUT_ENCODING_HEADER,
  PROJECTION_INPUT_VERSION,
  QUALIFIED_MEMORY_KEY_SEP,
  qualifyMemoryKey,
  type Umap3DLayoutOptions,
  umap3DLayout,
  validateProjectionInput,
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
  persistence: GraphProjectionGraphReads,
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
  persistence: GraphProjectionGraphReads,
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

export type CollectLibsqlProjectionInputOptions = {
  namespace: string;
  scope?: "exact" | "subtree";
  provenanceHeadRootHex?: string;
};

export function collectLibsqlProjectionInput(
  queryClient: LibsqlProjectionQueryClient,
  persistence: GraphProjectionGraphReads,
  input: CollectLibsqlProjectionInputOptions,
): Promise<NamespaceProjectionInput> {
  const source = createLibsqlGraphProjectionSource(queryClient);
  return collectNamespaceProjectionInput(source, persistence, input.namespace, {
    provenanceHeadRootHex: input.provenanceHeadRootHex,
    scope: input.scope,
  });
}

export function createLibsqlMemoriesVisualization(
  queryClient: LibsqlProjectionQueryClient,
  persistence: GraphProjectionPersistenceReads,
) {
  return createMemoriesVisualizationFromSource(
    createLibsqlGraphProjectionSource(queryClient),
    persistence,
  );
}
