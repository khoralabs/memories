/**
 * Public SQLite strategy API: open a store, then construct core and/or visualization adapters.
 * Low-level helpers (vec load, schema SQL, blob helpers) stay internal to this strategy.
 */
export {
  configureMemoriesSqlitePragmas,
  ensureCustomSqliteForExtensions,
  type MemoriesSqlitePragmaOptions,
  type OpenMemoriesDatabaseOptions,
  openMemoriesDatabase,
  openMemoriesDatabaseReadonly,
  openTestMemoriesDatabase,
} from "./connection";
export { buildNamespaceGraphLayout } from "./graph/build-namespace-graph-layout";
export { buildNamespaceSubtreeGraphLayout } from "./graph/build-namespace-subtree-graph-layout";
export {
  LABEL_PROPERTY_SYNTH_DIM,
  labelPropertySyntheticEmbedding,
} from "./graph/label-property-features";
export type { GraphLayoutEdge, GraphLayoutNode, NamespaceGraphLayout } from "./graph/layout-types";
export { QUALIFIED_MEMORY_KEY_SEP, qualifyMemoryKey } from "./graph/qualified-memory-key";
export {
  createSeededRandom,
  DEFAULT_UMAP_LAYOUT_SEED,
  fibonacciSphereLayout3D,
  minMaxNormalize3D,
  type Point3,
  type Umap3DLayoutOptions,
  umap3DLayout,
} from "./graph/umap-layout";
export { listMemoryNamespaces } from "./models/list-memory-namespaces";
export { listNamespacesUnderPrefix } from "./models/list-namespaces-under-prefix";
export {
  createMemoriesPersistence,
  getMemoriesSqliteDatabase,
  MemoriesPersistence,
} from "./persistence";
export {
  createMemoriesVisualization,
  MemoriesVisualization,
} from "./visualization";
export { loadEdgePreview } from "./visualization/edge-preview";
export { loadMemoryTextPreview, loadSourceMapTextPreview } from "./visualization/memory-preview";
export { loadMeanEmbeddingsForNamespace } from "./visualization/projection";
