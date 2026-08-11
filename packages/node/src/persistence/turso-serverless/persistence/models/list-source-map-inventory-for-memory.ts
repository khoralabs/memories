import type { SourceMapInventoryItem } from "../../../../persistence/core/persistence";
import type { DbCtx } from "../context";
import { ctxQueryAll } from "../db";

export async function listSourceMapInventoryForMemory(
  ctx: DbCtx,
  memoryId: string,
  limit: number,
): Promise<SourceMapInventoryItem[]> {
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new RangeError("limit must be a positive integer");
  }
  const rows = await ctxQueryAll<{
    sourceMapId: string;
    sourceKey: string;
    contentHash: string | null;
    createdAt: number;
    hasText: number;
    hasVector: number;
  }>(
    ctx,
    `SELECT sm._id AS sourceMapId,
            sm.source_key AS sourceKey,
            sm.content_hash AS contentHash,
            sm._ts_created AS createdAt,
            EXISTS(SELECT 1 FROM text_features tf WHERE tf.source_map_id = sm._id) AS hasText,
            EXISTS(SELECT 1 FROM vector_features vf WHERE vf.source_map_id = sm._id) AS hasVector
     FROM source_maps sm
     WHERE sm.memory_id = ?
     ORDER BY sm._ts_created DESC
     LIMIT ?`,
    [memoryId, limit],
  );

  return rows.map((r) => ({
    sourceKey: r.sourceKey,
    sourceMapId: r.sourceMapId,
    ...(r.contentHash != null && r.contentHash.length > 0 ? { contentHash: r.contentHash } : {}),
    createdAt: r.createdAt,
    hasText: Number(r.hasText) === 1,
    hasVector: Number(r.hasVector) === 1,
  }));
}
