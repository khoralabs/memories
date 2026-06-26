export type {
  HydratedNeighbor,
  HydratedSourceMapHit,
  LabelPropsSearchFormatter,
  LabelPropsSearchRole,
  MemoryGraphAssociation,
  NamespacePath,
  NamespacePathLiteral,
  NamespacePrefixKey,
  NamespacePrefixKeyCamel,
  NeighborConstraint,
  NeighborFilter,
  NeighborNodesFilter,
} from "@khoralabs/memories-persistence-core";
export {
  canonicalizeNamespacePrefixes,
  formatLabelPropsForSearch,
  isPrefixOf,
  NAMESPACE_MAX_DEPTH,
  NAMESPACE_SEGMENT_REGEX,
  NAMESPACE_SEPARATOR,
  NS_PREFIX_KEYS,
  NS_PREFIX_KEYS_CAMEL,
  namespaceFromSegments,
  namespaceLevels,
  namespacePath,
  namespacePrefixFieldForDepth,
  namespacePrefixFieldForDepthCamel,
  namespacePrefixFields,
  namespacePrefixFieldsCamel,
  namespaceSegments,
  propsToHumanSearchText,
  zNamespacePath,
} from "@khoralabs/memories-persistence-core";
export type {
  MemoriesBackendCapabilities,
  MemoriesGraph,
  MemoriesGraphIndex,
  MemoriesGraphMutation,
  MemoriesMutation,
  MemoriesMutationCore,
  MemoriesNeighborIndex,
  MemoriesPersistence,
  MemoriesPersistenceAsync,
  MemoriesPersistenceReads,
  MemoriesRetrieval,
  MemoriesRuntimeCtx,
  MemoryOpContext,
  SearchNamespaceScope,
} from "@khoralabs/memories-persistence-core/persistence";
export {
  buildCanonicalMemorySearchMetaTextAsync,
  DEFAULT_MEMORIES_BACKEND_CAPABILITIES,
  resolveMemoriesBackendCapabilities,
  upsertMemorySearchMetaVectorAsync,
  wrapSyncMemoriesPersistenceAsAsync,
} from "@khoralabs/memories-persistence-core/persistence";
export type { DeleteMemoryParams } from "../models/delete-memory";
export { deleteMemory } from "../models/delete-memory";
export { deleteMemoryAsync } from "../models/delete-memory-async";
export * from "./client";
export * from "./client-async";
export type {
  MergeMemoryContentItem,
  MergeMemoryParams,
  MergeMemoryParamsEdge,
  MergeMemoryParamsNode,
  MutationCtx,
} from "./merge-memory";
export {
  buildCanonicalMemorySearchMetaText,
  buildCanonicalMemorySearchMetaTextForMerge,
  catalogSchemaJsonForEdgeKind,
  catalogSchemaJsonForNodeKind,
  MEMORY_SEARCH_META_SOURCE_KEY,
  mergeMemory,
  upsertMemorySearchMetaVector,
  withDirectedEdgeProperties,
  zMergeMemoryContentItem,
  zUserSourceKey,
} from "./merge-memory";
export * from "./merge-memory-async";
export * from "./ontology";
export * from "./resolve-sourcemap";
export type {
  NeighborSearchOption,
  SearchContent,
  SearchHit,
  SearchNeighborHit,
  SearchParams,
} from "./search";
export { MAX_ADDITIONAL_NAMESPACES, normalizeSearchScopeFromParams, search } from "./search";
export * from "./search-async";
