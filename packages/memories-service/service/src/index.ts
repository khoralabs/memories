export type {
  MemoriesBackendCapabilities,
  MemoriesDatabaseBackend,
  MemoriesDatabaseBackendFactory,
  MemoriesDatabaseBackendStrategy,
  MemoriesDatabaseHandle,
  SqliteBackendStrategy,
  SqliteDatabaseContext,
  StrategyCapabilities,
} from "./backend";
export {
  DEFAULT_MEMORIES_BACKEND_CAPABILITIES,
  DEFAULT_SQLITE_STRATEGY_CAPABILITIES,
  resolveStrategyCapabilities,
  strategyCacheKey,
} from "./backend";
export {
  type CachedConnection,
  type ConnectionCache,
  type CreateConnectionCacheOptions,
  createConnectionCache,
  deleteCachedConnection,
  getCachedConnection,
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
  createInMemoryOntologyStore,
  type MemoriesDatabaseOntologyStore,
  type OntologyLinkRecord,
} from "./ontology-registry";
export {
  createReversibleOwnerKeyEncoder,
  OWNER_KEY_ENCODING_VERSION,
  type OwnerKeyEncoder,
  resolveEncodedDatabasePath,
} from "./owner-key-encoder";
export {
  createInMemoryPlacementStore,
  type InMemoryPlacementStoreOptions,
  type MemoriesDatabasePlacementStore,
} from "./placement";
export {
  type CreateBackendResolverOptions,
  createBackendResolver,
  type MemoriesDatabaseBackendResolver,
} from "./resolver";
export {
  type CreateMemoriesDatabaseServiceOptions,
  createMemoriesDatabaseService,
} from "./service";
export type {
  DatabaseKind,
  DatabaseListFilter,
  MemoriesDatabaseId,
  MemoriesDatabaseService,
} from "./types";
export {
  cacheKeyForId,
  validateDatabaseKind,
  validateMemoriesDatabaseId,
  validateOwnerKey,
} from "./validate";
