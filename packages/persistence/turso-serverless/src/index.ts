export { createTursoClients, type TursoClients, type TursoCredentials } from "./client";
export { MEMORIES_SCHEMA_VERSION, migrations } from "./migrations";
export {
  createMemoriesTursoServerlessPersistence,
  type MemoriesTursoServerlessOptions,
  MemoriesTursoServerlessPersistence,
  migrateMemoriesTursoServerless,
} from "./persistence";
export {
  CONTENT_OUTBOX_SQL,
  MEMORIES_INDEXES_SQL,
  MEMORIES_SCHEMA_SQL,
} from "./schema";
export {
  buildFtsMatchFromUserText,
  memoriesWhereClauseFromScope,
  memoryIdSubqueryFromScope,
  vector32Json,
} from "./sql";
export { hasTursoIntegrationEnv, openTursoTestPersistence } from "./test-harness";
export { NestedTransactionError } from "./transactions";
export {
  SCHEMA_VERSION_TABLE_SQL,
  TEXT_FEATURES_FTS_INDEX_SQL,
  TURSO_PRAGMAS_SQL,
} from "./turso-schema";
