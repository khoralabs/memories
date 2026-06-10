/**
 * Public SQLite persistence API: open a store, then construct {@link MemoriesPersistence}.
 */
export {
  blobToVector,
  configureMemoriesSqlitePragmas,
  ensureCustomSqliteForExtensions,
  type MemoriesSqlitePragmaOptions,
  type OpenMemoriesDatabaseOptions,
  openMemoriesDatabase,
  openMemoriesDatabaseReadonly,
  openTestMemoriesDatabase,
  vectorToBlob,
} from "./connection";
export {
  type ContentAtRootHit,
  getMemoryContentAtRootHex,
  reconstructStoreAtRootHex,
} from "./models/content-outbox";
export { listMemoryNamespaces } from "./models/list-memory-namespaces";
export { listNamespacesUnderPrefix } from "./models/list-namespaces-under-prefix";
export {
  createMemoriesPersistence,
  getMemoriesSqliteDatabase,
  MemoriesPersistence,
} from "./persistence";
