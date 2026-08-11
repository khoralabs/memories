import { blobToVector } from "../connection";
import type { DbCtx } from "./context";

/**
 * Remove text/FTS/vector/vec-index rows and the source_maps row for one source map.
 * Idempotent when absent.
 */
export function clearSourceMapFeatures(ctx: DbCtx, sourceMapId: string): void {
  const { db, stmts } = ctx;
  const sm = db
    .query<{ _id: string }, [string]>(`SELECT _id FROM source_maps WHERE _id = ?`)
    .get(sourceMapId);
  if (!sm) return;

  stmts.deleteTextFeaturesFtsBySourceMapId.run(sourceMapId);
  stmts.deleteTextFeaturesBySourceMapId.run(sourceMapId);

  const vfRows = db
    .query<{ _id: string; vector: Buffer | Uint8Array }, [string]>(
      `SELECT _id, vector FROM vector_features WHERE source_map_id = ?`,
    )
    .all(sourceMapId);
  for (const row of vfRows) {
    const floats = blobToVector(
      row.vector instanceof Buffer ? new Uint8Array(row.vector) : row.vector,
    );
    const dim = floats.length;
    if (dim >= 512 && dim <= 3072) {
      stmts.getDeleteVectorVecByFeatureId(dim).run(row._id);
    }
    stmts.deleteVectorFeaturesByFeatureId.run(row._id);
  }

  stmts.deleteSourceMapById.run(sourceMapId);
}
