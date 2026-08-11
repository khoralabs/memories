/**
 * Public SQLite persistence API: open a store, then construct {@link MemoriesPersistence}.
 */
export {
  blobToVector,
  configureMemoriesSqlitePragmas,
  ensureCustomSqliteForExtensions,
  type MemoriesSqlitePragmaOptions,
  memoriesSqliteVecAvailable,
  type OpenMemoriesDatabaseOptions,
  openMemoriesDatabase,
  openMemoriesDatabaseReadonly,
  openTestMemoriesDatabase,
  vectorToBlob,
} from "./connection";
export {
  type BunS3ContentBlobColdStoreOptions,
  createBunS3ContentBlobColdStore,
  createMemoryContentBlobColdStore,
} from "./content-blob-cold-store-bun";
export {
  type ContentAtRootHit,
  evacuateContentBlobsOutsideHotWindow,
  getMemoryContentAtRootHex,
  getMemoryContentAtRootHexAsync,
  reconstructStoreAtRootHex,
  reconstructStoreAtRootHexAsync,
} from "./models/content-outbox";
export { listMemoryNamespaces } from "./models/list-memory-namespaces";
export { listNamespacesUnderPrefix } from "./models/list-namespaces-under-prefix";
export {
  createMemoriesPersistence,
  getMemoriesSqliteDatabase,
  MemoriesPersistence,
} from "./persistence";
export {
  createMemoriesPersistenceAsync,
  getMemoriesSqliteDatabaseFromAsync,
  getMemoriesSyncPersistenceFromAsync,
  wrapMemoriesPersistenceAsAsync,
} from "./persistence-async";
