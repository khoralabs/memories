export { type IntegrateNewMemoryArgs, integrateNewMemoryIntoGraph } from "./integrate.js";
export {
  RETRIEVAL_AUTOLINK_EDGE_KIND,
  RETRIEVAL_BOOTSTRAP_NODE_KIND,
  type RetrievalAutolinkOntology,
  retrievalAutolinkOntology,
  zRetrievalAutolinkEdgeProps,
  zRetrievalBootstrapNodeProps,
  zRetrievalSearchConfig,
} from "./ontology.js";
export {
  type ComputeLexicalLinkOptions,
  computeLexicalLinkMergeSlice,
  type LexicalLinkMergePatch,
} from "./planner.js";
export { normalizeSearchConfigSnapshot, type SearchConfigSnapshotInput } from "./search-config.js";
