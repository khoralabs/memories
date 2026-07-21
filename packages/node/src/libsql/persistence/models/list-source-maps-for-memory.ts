import type { SourceMap } from "@khoralabs/memories-persistence-core/persistence";
import type { DbCtx } from "../context";
import { ctxQueryAll } from "../db";

export async function listSourceMapsForMemory(
  ctx: DbCtx,
  memoryId: string,
  limit: number,
): Promise<SourceMap[]> {
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new RangeError("limit must be a positive integer");
  }
  return ctxQueryAll<SourceMap>(
    ctx,
    `SELECT _id, _ts_created, memory_id, source_key, content_hash
     FROM source_maps
     WHERE memory_id = ?
     ORDER BY _ts_created DESC
     LIMIT ?`,
    [memoryId, limit],
  );
}
