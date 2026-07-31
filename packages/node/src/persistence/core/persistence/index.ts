export type { NamespacePath } from "../models/namespace-path";
export type { MemoriesPersistenceAsync } from "./async-types";
export {
  defineSchema,
  defineTable,
  documentValidator,
  type ZIdMeta,
  zId,
} from "./define-schema";
export {
  buildCanonicalMemorySearchMetaText,
  buildCanonicalMemorySearchMetaTextAsync,
  upsertMemorySearchMetaVector,
  upsertMemorySearchMetaVectorAsync,
} from "./facade";
export type { MemoriesPersistenceSchema } from "./row-schemas";
export * from "./row-schemas";
export type {
  Edge,
  EdgeLabel,
  EdgeLabelAssignment,
  Memory,
  Node,
  NodeLabel,
  NodeLabelAssignment,
  SourceMap,
  SourceMapLocators,
  SourceMapRow,
  TextFeature,
  TextFeatureExportRow,
  VectorFeature,
} from "./rows";
export type {
  EdgePreviewPayload,
  GraphEdgeLink,
  GraphMemoryEmbedding,
  GraphNode,
  MemoriesBackendCapabilities,
  MemoriesGraph,
  MemoriesGraphIndex,
  MemoriesGraphMutation,
  MemoriesMutation,
  MemoriesMutationCore,
  MemoriesNeighborIndex,
  MemoriesPersistence,
  MemoriesPersistenceReads,
  MemoriesRetrieval,
  MemoriesRuntimeCtx,
  MemoryOpContext,
  NamespaceMetadataInfo,
  SearchNamespaceScope,
  SearchVectorSourceMapIdsResult,
  VectorSearchMethod,
} from "./types";
export {
  DEFAULT_MEMORIES_BACKEND_CAPABILITIES,
  resolveMemoriesBackendCapabilities,
  resolveVectorSearchMethod,
} from "./types";
export { wrapSyncMemoriesPersistenceAsAsync } from "./wrap-sync-as-async";
