export type {
  /** @deprecated Import ontology APIs from @khoralabs/memories-ontologies instead. */
  EdgeLabelInstance,
  /** @deprecated Import ontology APIs from @khoralabs/memories-ontologies instead. */
  LabelSchemaMap,
  /** @deprecated Import ontology APIs from @khoralabs/memories-ontologies instead. */
  NodeLabelInstance,
  /** @deprecated Import ontology APIs from @khoralabs/memories-ontologies instead. */
  OntologyDefinition,
  /** @deprecated Import ontology APIs from @khoralabs/memories-ontologies instead. */
  OntologyLabelInstance,
  /** @deprecated Import ontology APIs from @khoralabs/memories-ontologies instead. */
  StandardJSONSchemaV1,
  /** @deprecated Import ontology APIs from @khoralabs/memories-ontologies instead. */
  StandardSchemaV1,
} from "@khoralabs/memories-ontologies";
export {
  /** @deprecated Import ontology APIs from @khoralabs/memories-ontologies instead. */
  defineOntology,
  /** @deprecated Import ontology APIs from @khoralabs/memories-ontologies instead. */
  edgeLabelPropsSchema,
  /** @deprecated Import ontology APIs from @khoralabs/memories-ontologies instead. */
  nodeLabelPropsSchema,
  /** @deprecated Import ontology APIs from @khoralabs/memories-ontologies instead. */
  propsSchemaToJson,
  /** @deprecated Import ontology APIs from @khoralabs/memories-ontologies instead. */
  validateEdgeLabel,
  /** @deprecated Import ontology APIs from @khoralabs/memories-ontologies instead. */
  validateNodeLabel,
} from "@khoralabs/memories-ontologies";
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
