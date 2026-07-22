import type { Database } from "bun:sqlite";

const VEC_TABLE_DIM_RE = /^vector_features_vec_d_(\d+)$/;

/**
 * Distinct embedding widths inferred from this strategy's per-dimension vector index table names.
 */
export function listVectorEmbeddingIndexDimensions(db: Database): number[] {
  const rows = db
    .query<{ name: string }, []>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'vector_features_vec_d_%'`,
    )
    .all();
  const dims = new Set<number>();
  for (const { name } of rows) {
    const m = VEC_TABLE_DIM_RE.exec(name);
    if (m?.[1]) dims.add(Number(m[1]));
  }
  return [...dims].sort((a, b) => a - b);
}
