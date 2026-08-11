export {
  type AutolinkIntegrateDeps,
  type IntegrateNewMemoryArgs,
  runAutolinkIntegrate,
} from "./integrate.js";
export {
  RETRIEVAL_SEED_NODE_KIND,
  RETRIEVAL_SIMILARITY_EDGE_KIND,
  type RetrievalSeedNodeProps,
  type RetrievalSimilarityEdgeProps,
} from "./kinds.js";
export {
  canonicalRetrievalEdgeLabelShapes,
  canonicalRetrievalLabelPropsSearchFormatter,
  canonicalRetrievalNodeLabelShapes,
  type RetrievalSimilarityOntology,
  retrievalSimilarityOntology,
  zRetrievalSearchConfig,
  zRetrievalSeedNodeProps,
  zRetrievalSimilarityEdgeProps,
} from "./ontology.js";
export {
  type ComputeLexicalLinkOptions,
  computeLexicalLinkMergeSlice,
  type LexicalLinkMergePatch,
} from "./planner.js";
export { normalizeSearchConfigSnapshot, type SearchConfigSnapshotInput } from "./search-config.js";
export {
  getAutolinkSession,
  provideAutolinkSession,
  releaseAutolinkSession,
  requireAutolinkSession,
  resetAutolinkSessionRegistryForTests,
} from "./session.js";
