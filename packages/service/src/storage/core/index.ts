export type {
  LibsqlBackendStrategy,
  MemoriesBackendCapabilities,
  MemoriesDatabaseBackend,
  MemoriesDatabaseBackendFactory,
  MemoriesDatabaseBackendStrategy,
  MemoriesDatabaseHandle,
  SqliteBackendStrategy,
  StrategyCapabilities,
  SyncPersistenceContext,
  TursoServerlessBackendStrategy,
} from "./backend";
export {
  DEFAULT_LIBSQL_STRATEGY_CAPABILITIES,
  DEFAULT_MEMORIES_BACKEND_CAPABILITIES,
  DEFAULT_SQLITE_STRATEGY_CAPABILITIES,
  DEFAULT_TURSO_SERVERLESS_STRATEGY_CAPABILITIES,
  resolveStrategyCapabilities,
  strategyCacheKey,
} from "./backend";
export type { DatabaseKind, DatabaseListFilter, MemoriesDatabaseId } from "./database-id";
export {
  databaseKey,
  parseDatabaseKey,
} from "./database-key";
export {
  canonicalizeStoredOntology,
  hashStoredOntology,
  listOntologyLabelKinds,
  normalizeStoredOntologyJsonSchema,
  type OntologyLabelKinds,
  ontologyMatchesLabelKinds,
  STORED_ONTOLOGY_JSON_SCHEMA_URI,
  type StoredOntologyJsonSchema,
  type StoredOntologyJsonSchemaMetadata,
  type StoredOntologyLabelMapSchema,
} from "./ontology";
export {
  createInMemoryOntologyStore,
  currentLinkForRows,
  type MemoriesDatabaseOntologyStore,
  type OntologyLinkRecord,
} from "./ontology-registry";
export {
  createReversibleOwnerKeyEncoder,
  DATABASE_FILENAME,
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
  type MemoriesDatabaseSnapshot,
  UnsupportedStorageFeatureError,
  unsupportedStorageFeature,
} from "./snapshot";
export {
  parseStrategy,
  type SerializedBackendStrategy,
  serializeStrategy,
} from "./strategy-json";
export {
  cacheKeyForId,
  validateDatabaseKind,
  validateMemoriesDatabaseId,
  validateOwnerKey,
} from "./validate";
