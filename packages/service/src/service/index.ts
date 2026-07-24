/** @deprecated Storage contracts are owned by ../storage/core/index. */
export * from "../storage/core/index";
export {
  type CompositeBackendFactoryMap,
  createCompositeBackendFactory,
  UnknownBackendStrategyError,
} from "./backend-factory";
export {
  type CachedConnection,
  type ConnectionCache,
  type CreateConnectionCacheOptions,
  createConnectionCache,
  deleteCachedConnection,
  type EvictionCloseResult,
  getCachedConnection,
  releaseCachedConnection,
  setCachedConnection,
} from "./connection-cache";
export {
  canonicalizeStoredOntology,
  hashStoredOntology,
  listOntologyLabelKinds,
  normalizeStoredOntologyJsonSchema,
  type OntologyLabelKinds,
  ontologyMatchesLabelKinds,
  ontologyToStoredJsonSchema,
  STORED_ONTOLOGY_JSON_SCHEMA_URI,
  type StoredOntologyJsonSchema,
  type StoredOntologyJsonSchemaMetadata,
  type StoredOntologyLabelMapSchema,
} from "./ontology";
export {
  type CreateBackendResolverOptions,
  createBackendResolver,
  type MemoriesDatabaseBackendResolver,
} from "./resolver";
export {
  type CreateMemoriesDatabaseServiceOptions,
  createMemoriesDatabaseService,
} from "./service";
export type { MemoriesDatabaseService } from "./types";
