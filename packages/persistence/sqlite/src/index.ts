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
export { listMemoryNamespaces } from "./models/list-memory-namespaces";
export { listNamespacesUnderPrefix } from "./models/list-namespaces-under-prefix";
export {
  createMemoriesPersistence,
  getMemoriesSqliteDatabase,
  MemoriesPersistence,
} from "./persistence";
