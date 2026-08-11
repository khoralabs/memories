import type { DbCtx } from "../context";
import { ctxExec, ctxQueryOne } from "../db";

/**
 * Remove text/vector rows and the source_maps row for one source map.
 * Idempotent when absent.
 */
export async function clearSourceMapFeatures(ctx: DbCtx, sourceMapId: string): Promise<void> {
  const sm = await ctxQueryOne<{ _id: string }>(ctx, `SELECT _id FROM source_maps WHERE _id = ?`, [
    sourceMapId,
  ]);
  if (!sm) return;

  await ctxExec(ctx, `DELETE FROM text_features WHERE source_map_id = ?`, [sourceMapId]);
  await ctxExec(ctx, `DELETE FROM vector_features WHERE source_map_id = ?`, [sourceMapId]);
  await ctxExec(ctx, `DELETE FROM source_maps WHERE _id = ?`, [sourceMapId]);
}
