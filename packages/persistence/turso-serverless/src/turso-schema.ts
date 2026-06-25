/** Turso-native search indexes and schema version tracking (shared Turso-family DDL). */

export const SCHEMA_VERSION_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS "_schema_version" (
  "version" TEXT PRIMARY KEY NOT NULL,
  "applied_at" REAL NOT NULL
);
`;

/** Tantivy FTS index on text_features.text (not FTS5 virtual table). */
export const TEXT_FEATURES_FTS_INDEX_SQL = `
CREATE INDEX IF NOT EXISTS idx_text_features_text_fts ON text_features USING fts(text);
`;

export const TURSO_PRAGMAS_SQL = `
PRAGMA foreign_keys = ON;
`;
