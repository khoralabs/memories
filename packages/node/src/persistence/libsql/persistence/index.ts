export {
  createLibsqlDatabase,
  type LibsqlCredentials,
  type LibsqlDatabase,
  queryOne as readQueryOne,
} from "./client";
export {
  LIBSQL_PRAGMAS_SQL,
  SCHEMA_VERSION_TABLE_SQL,
  TEXT_FEATURES_FTS_SQL,
} from "./libsql-schema";
export {
  getCurrentSchemaVersion,
  MEMORIES_SCHEMA_VERSION,
  migrateMemoriesLibsql,
  migrations,
} from "./migrations";
export {
  createMemoriesLibsqlPersistence,
  type MemoriesLibsqlOptions,
  MemoriesLibsqlPersistence,
} from "./persistence";
export {
  CONTENT_BLOBS_SQL,
  CONTENT_OUTBOX_SQL,
  MEMORIES_INDEXES_SQL,
  MEMORIES_SCHEMA_SQL,
  NAMESPACE_METADATA_SQL,
} from "./schema";
export {
  buildFtsMatchFromUserText,
  memoriesWhereClauseFromScope,
  memoryIdSubqueryFromScope,
  vector32Json,
} from "./sql";
export { openLibsqlTestPersistence } from "./test-harness";
export { NestedTransactionError } from "./transactions";
