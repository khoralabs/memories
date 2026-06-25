import type { TursoDatabase } from "../db";
import { readQueryAll } from "../db";

/** Distinct embedding widths inferred from stored vector BLOB byte lengths. */
export async function listVectorEmbeddingIndexDimensions(db: TursoDatabase): Promise<number[]> {
  const rows = await readQueryAll<{ dim: number }>(
    db,
    `SELECT DISTINCT (length(vector) / 4) AS dim
     FROM vector_features
     WHERE length(vector) >= 2048 AND length(vector) <= 12288`,
  );
  const dims = new Set<number>();
  for (const { dim } of rows) {
    if (Number.isInteger(dim) && dim >= 512 && dim <= 3072) dims.add(dim);
  }
  return [...dims].sort((a, b) => a - b);
}
