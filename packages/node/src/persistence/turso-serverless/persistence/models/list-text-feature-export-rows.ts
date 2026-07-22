import type { TextFeatureExportRow } from "../../../../persistence/core/persistence";
import type { DbCtx } from "../context";
import { ctxQueryAll } from "../db";

export async function listTextFeatureExportRowsForMemory(
  ctx: DbCtx,
  memoryId: string,
): Promise<TextFeatureExportRow[]> {
  return ctxQueryAll<TextFeatureExportRow>(
    ctx,
    `SELECT sm.memory_id AS memory_id, sm.source_key AS source_key, tf.text AS text
     FROM text_features tf
     INNER JOIN source_maps sm ON tf.source_map_id = sm._id
     WHERE sm.memory_id = ?`,
    [memoryId],
  );
}
