/** LibSQL schema helpers: version table + FTS5 lexical index. */

export const SCHEMA_VERSION_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS "_schema_version" (
  "version" TEXT PRIMARY KEY NOT NULL,
  "applied_at" REAL NOT NULL
);
`;

/** FTS5 mirror of `text_features` for full-text search (caller syncs rows). */
export const TEXT_FEATURES_FTS_SQL = `
CREATE VIRTUAL TABLE IF NOT EXISTS text_features_fts USING fts5(
  text_feature_id UNINDEXED,
  memory_id UNINDEXED,
  source_map_id UNINDEXED,
  text,
  tokenize = 'porter unicode61'
);
`;

export const VECTOR_FEATURES_ANN_INDEX_SQL = `
CREATE INDEX IF NOT EXISTS idx_vector_features_ann
  ON vector_features (libsql_vector_idx(vector, 'metric=cosine'));
`;

export const LIBSQL_PRAGMAS_SQL = `
PRAGMA foreign_keys = ON;
`;
