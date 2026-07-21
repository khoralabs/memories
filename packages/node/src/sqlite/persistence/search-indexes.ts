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
const diskAnnAvailability = new WeakMap<Database, boolean>();

/** `vector_features_vec_d_<dim>` — one vec0 table per embedding dimension (512–3072). */
export function vectorVecTableName(dim: number): string {
  if (!Number.isInteger(dim) || dim < 512 || dim > 3072) {
    throw new RangeError(`vec0 dimension out of range: ${dim}`);
  }
  if (dim % 8 !== 0) {
    throw new RangeError(`vec0 binary quantizer dimension must be divisible by 8: ${dim}`);
  }
  return `${vecTablePrefix}${dim}`;
}

/** Ensure a sqlite-vec vec0 table exists for the given float length. */
export function ensureVectorFeaturesVecTable(db: Database, dim: number): void {
  const name = vectorVecTableName(dim);
  db.run(`CREATE VIRTUAL TABLE IF NOT EXISTS "${name.replaceAll('"', '""')}" USING vec0(
  vector_feature_id TEXT PRIMARY KEY,
  embedding float[${dim}] INDEXED BY diskann(neighbor_quantizer=binary)
)`);
}

/** Whether this connection's sqlite-vec build supports DiskANN. */
export function hasVectorAnnSearch(db: Database): boolean {
  return diskAnnAvailability.get(db) ?? true;
}

/**
 * Replace legacy flat vec0 tables with DiskANN tables and repopulate them from
 * canonical little-endian float32 BLOB rows in `vector_features`.
 */
export function backfillVectorFeaturesVecTables(db: Database): boolean {
  const probe = "__memories_diskann_probe";
  try {
    db.run(`CREATE VIRTUAL TABLE "${probe}" USING vec0(
      embedding float[8] INDEXED BY diskann(neighbor_quantizer=binary)
    )`);
    db.run(`DROP TABLE "${probe}"`);
  } catch {
    try {
      db.run(`DROP TABLE IF EXISTS "${probe}"`);
    } catch {}
    diskAnnAvailability.set(db, false);
    return false;
  }

  const rowDimensions = db
    .query<{ dim: number }, []>(
      `SELECT DISTINCT length(vector) / 4 AS dim
       FROM vector_features
       WHERE length(vector) % 4 = 0`,
    )
    .all()
    .map(({ dim }) => dim)
    .filter((dim) => Number.isInteger(dim) && dim >= 512 && dim <= 3072 && dim % 8 === 0);
  const tableDimensions = db
    .query<{ name: string }, [string]>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE ?`,
    )
    .all(`${vecTablePrefix}%`)
    .flatMap(({ name }) => {
      const match = /^vector_features_vec_d_(\d+)$/.exec(name);
      const dim = match ? Number(match[1]) : 0;
      return dim >= 512 && dim <= 3072 && dim % 8 === 0 ? [dim] : [];
    });
  const dimensions = [...new Set([...rowDimensions, ...tableDimensions])];

  db.transaction(() => {
    for (const dim of dimensions) {
      const name = vectorVecTableName(dim);
      const existing = db
        .query<{ sql: string }, [string]>(
          `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`,
        )
        .get(name);
      if (existing && /INDEXED\s+BY\s+diskann/i.test(existing.sql)) continue;
      if (existing) db.run(`DROP TABLE "${name}"`);
      ensureVectorFeaturesVecTable(db, dim);
      db.run(
        `INSERT INTO "${name}" (vector_feature_id, embedding)
         SELECT _id, vector FROM vector_features WHERE length(vector) = ?`,
        [dim * Float32Array.BYTES_PER_ELEMENT],
      );
    }
  })();

  diskAnnAvailability.set(db, true);
  return true;
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
