export { type IntegrateNewMemoryArgs, integrateNewMemoryIntoGraph } from "./integrate.js";
export {
  canonicalRetrievalEdgeLabelShapes,
  canonicalRetrievalLabelPropsSearchFormatter,
  canonicalRetrievalNodeLabelShapes,
  RETRIEVAL_SEED_NODE_KIND,
  RETRIEVAL_SIMILARITY_EDGE_KIND,
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
