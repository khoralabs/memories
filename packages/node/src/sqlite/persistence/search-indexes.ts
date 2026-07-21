import type { Database } from "bun:sqlite";
import type { MemoriesSqliteStmts } from "./models/prepared-stmts";

/** FTS5 mirror of `text_features` for full-text search (caller syncs rows). */
export const TEXT_FEATURES_FTS_SQL = `
CREATE VIRTUAL TABLE IF NOT EXISTS text_features_fts USING fts5(
  text_feature_id UNINDEXED,
  memory_id UNINDEXED,
  source_map_id UNINDEXED,
  text,
  tokenize = 'porter unicode61'
);
`.trim();

const vecTablePrefix = "vector_features_vec_d_";

/** `vector_features_vec_d_<dim>` — one vec0 table per embedding dimension (512–3072). */
export function vectorVecTableName(dim: number): string {
  if (!Number.isInteger(dim) || dim < 512 || dim > 3072) {
    throw new RangeError(`vec0 dimension out of range: ${dim}`);
  }
  return `${vecTablePrefix}${dim}`;
}

/** Ensure a sqlite-vec vec0 table exists for the given float length. */
export function ensureVectorFeaturesVecTable(db: Database, dim: number): void {
  const name = vectorVecTableName(dim);
  db.run(`CREATE VIRTUAL TABLE IF NOT EXISTS "${name.replaceAll('"', '""')}" USING vec0(
  vector_feature_id TEXT PRIMARY KEY,
  memory_id TEXT,
  embedding float[${dim}]
)`);
}

/** Remove vec index rows for a memory across all dimension tables. */
export function deleteVectorVecRowsForMemory(
  db: Database,
  stmts: MemoriesSqliteStmts,
  memoryId: string,
): void {
  const rows = db
    .query<{ name: string }, [string]>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE ?`,
    )
    .all(`${vecTablePrefix}%`);

  const vec0Base = /^vector_features_vec_d_\d+$/;
  for (const { name } of rows) {
    if (!vec0Base.test(name)) continue;
    stmts.getDeleteVectorVecByMemoryIdForTable(name).run(memoryId);
  }
}
