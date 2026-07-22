import type { SourceMap } from "../../../../persistence/core/persistence";
import type { DbCtx } from "./context";

/**
 * Most recently created source maps for a memory (bounded).
 */
export function listSourceMapsForMemory(ctx: DbCtx, memoryId: string, limit: number): SourceMap[] {
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new RangeError("limit must be a positive integer");
  }
  return ctx.stmts.listSourceMapsForMemory.all(memoryId, limit) as SourceMap[];
}
