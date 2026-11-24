/** Derived search projection queue (ADR 0002); not tip-outbox facets. */
export const SEARCH_INDEX_OUTBOX_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS "memory_search_index_outbox" (
  "_id" TEXT PRIMARY KEY NOT NULL,
  "_ts_created" REAL NOT NULL,
  "namespace" TEXT NOT NULL,
  "memory_key" TEXT NOT NULL,
  "cause_id" TEXT,
  "kind" TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_memory_search_index_outbox_ts"
  ON "memory_search_index_outbox" ("_ts_created");
`.trim();

export const SQL_INSERT_SEARCH_INDEX_OUTBOX = `INSERT INTO memory_search_index_outbox (_id, _ts_created, namespace, memory_key, cause_id, kind) VALUES (?, ?, ?, ?, ?, ?)`;

export const SQL_SELECT_SEARCH_INDEX_OUTBOX = `SELECT _id AS id, namespace, memory_key AS memoryKey, cause_id AS causeId, kind FROM memory_search_index_outbox ORDER BY _ts_created ASC, rowid ASC LIMIT ?`;

export const SQL_COUNT_SEARCH_INDEX_OUTBOX = `SELECT COUNT(*) AS n FROM memory_search_index_outbox`;

export const SQL_PENDING_SEARCH_INDEX_OUTBOX_FOR_KEY = `SELECT 1 AS n FROM memory_search_index_outbox WHERE namespace = ? AND memory_key = ? LIMIT 1`;

export const SQL_DELETE_SEARCH_INDEX_OUTBOX = `DELETE FROM memory_search_index_outbox WHERE _id = ?`;

export const DEFAULT_SEARCH_INDEX_DRAIN_LIMIT = 256;
