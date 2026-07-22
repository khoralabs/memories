import type { TextFeatureExportRow } from "../../../../persistence/core/persistence";
import type { DbCtx } from "./context";

/**
 * Denormalized text rows for JSONL export / prefetch (join text_features + source_maps).
 */
export function listTextFeatureExportRowsForMemory(
  ctx: DbCtx,
  memoryId: string,
): TextFeatureExportRow[] {
  return ctx.stmts.listTextFeatureExportRowsForMemory.all(memoryId) as TextFeatureExportRow[];
}
