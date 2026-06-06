import { deleteVectorVecRowsForMemory } from "../search-indexes";
import type { DbCtx } from "./context";

/** Removes features, FTS, vec index rows, edges, and node-label links for one **node** memory. */
function clearNodeMemorySubtree(ctx: DbCtx, memoryId: string, nodeId: string): void {
  const { db, stmts } = ctx;
  stmts.deleteMemoryScopesByMemoryId.run(memoryId);
  deleteVectorVecRowsForMemory(db, stmts, memoryId);
  stmts.deleteTextFeaturesFtsByMemoryId.run(memoryId);
  stmts.deleteTextFeaturesByMemoryId.run(memoryId);
  stmts.deleteVectorFeaturesByMemoryId.run(memoryId);
  stmts.deleteSourceMapsByMemoryId.run(memoryId);

  /** Edge-attached memories referencing incident edges (handled explicitly when `edge_id` column exists). */
  try {
    stmts.deleteMemoriesByIncidentEdgeNodeId.run(nodeId, nodeId);
  } catch {
    /* pre-migration DBs without edge_id */
  }

  stmts.deleteEdgesByIncidentNodeId.run(nodeId, nodeId);
  stmts.deleteNodeLabelAssignmentsByNodeId.run(nodeId);
}

/** Clears indexed features and edge label assignments for an **edge** memory; keeps the `edges` row for merge re-insert. */
function clearEdgeMemorySubtree(ctx: DbCtx, memoryId: string, edgeId: string): void {
  const { db, stmts } = ctx;
  stmts.deleteMemoryScopesByMemoryId.run(memoryId);
  deleteVectorVecRowsForMemory(db, stmts, memoryId);
  stmts.deleteTextFeaturesFtsByMemoryId.run(memoryId);
  stmts.deleteTextFeaturesByMemoryId.run(memoryId);
  stmts.deleteVectorFeaturesByMemoryId.run(memoryId);
  stmts.deleteSourceMapsByMemoryId.run(memoryId);
  stmts.deleteEdgeLabelAssignmentsByEdgeId.run(edgeId);
}

/**
 * Removes features, FTS, vec index, and graph-linked rows for one memory.
 * See {@link MemoriesMutationCore.clearMemorySubtree} in core for semantics.
 */
export function clearMemorySubtree(
  ctx: DbCtx,
  input:
    | { memoryKind: "node"; memoryId: string; nodeId: string }
    | { memoryKind: "edge"; memoryId: string; edgeId: string },
): void {
  if (input.memoryKind === "node") {
    clearNodeMemorySubtree(ctx, input.memoryId, input.nodeId);
  } else {
    clearEdgeMemorySubtree(ctx, input.memoryId, input.edgeId);
  }
}
