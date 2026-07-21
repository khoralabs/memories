/** Pipeline helpers: embedding adapters, logical-memory decomposition, merge-slice + search-meta refresh. */

export type {
  /** @deprecated Import mergeOntologies from @khoralabs/memories-ontologies instead. */
  MergeOntologyTuple,
} from "@khoralabs/memories-ontologies";
export {
  /** @deprecated Import mergeOntologies from @khoralabs/memories-ontologies instead. */
  mergeOntologies,
} from "@khoralabs/memories-ontologies";
export * from "./embedding-model";
export * from "./file-to-content";
export * from "./logical-memory";
export * from "./memory-search-pipeline";
export * from "./merge-logical-memory";
export * from "./text-to-content";
