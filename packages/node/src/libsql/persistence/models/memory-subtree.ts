import type { DbCtx } from "../context";
import { ctxExec } from "../db";

async function clearNodeMemorySubtree(ctx: DbCtx, memoryId: string, nodeId: string): Promise<void> {
  await ctxExec(ctx, `DELETE FROM text_features_fts WHERE memory_id = ?`, [memoryId]);
  await ctxExec(ctx, `DELETE FROM memory_scopes WHERE memory_id = ?`, [memoryId]);
  await ctxExec(ctx, `DELETE FROM text_features WHERE memory_id = ?`, [memoryId]);
  await ctxExec(ctx, `DELETE FROM vector_features WHERE memory_id = ?`, [memoryId]);
  await ctxExec(ctx, `DELETE FROM source_maps WHERE memory_id = ?`, [memoryId]);
  await ctxExec(
    ctx,
    `DELETE FROM memories WHERE edge_id IN (
       SELECT _id from edges WHERE from_node_id = ? OR to_node_id = ?
     )`,
    [nodeId, nodeId],
  );
  await ctxExec(ctx, `DELETE FROM edges WHERE from_node_id = ? OR to_node_id = ?`, [
    nodeId,
    nodeId,
  ]);
  await ctxExec(ctx, `DELETE FROM node_label_assignments WHERE node_id = ?`, [nodeId]);
}

async function clearEdgeMemorySubtree(ctx: DbCtx, memoryId: string, edgeId: string): Promise<void> {
  await ctxExec(ctx, `DELETE FROM text_features_fts WHERE memory_id = ?`, [memoryId]);
  await ctxExec(ctx, `DELETE FROM memory_scopes WHERE memory_id = ?`, [memoryId]);
  await ctxExec(ctx, `DELETE FROM text_features WHERE memory_id = ?`, [memoryId]);
  await ctxExec(ctx, `DELETE FROM vector_features WHERE memory_id = ?`, [memoryId]);
  await ctxExec(ctx, `DELETE FROM source_maps WHERE memory_id = ?`, [memoryId]);
  await ctxExec(ctx, `DELETE FROM edge_label_assignments WHERE edge_id = ?`, [edgeId]);
}

export async function clearMemorySubtree(
  ctx: DbCtx,
  input:
    | { memoryKind: "node"; memoryId: string; nodeId: string }
    | { memoryKind: "edge"; memoryId: string; edgeId: string },
): Promise<void> {
  if (input.memoryKind === "node") {
    await clearNodeMemorySubtree(ctx, input.memoryId, input.nodeId);
  } else {
    await clearEdgeMemorySubtree(ctx, input.memoryId, input.edgeId);
  }
}
