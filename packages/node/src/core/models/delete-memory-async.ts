import { runWithOpTelemetryAsync } from "../../telemetry/index.js";
import { buildMemoryOpContext, type MemoryMutationAttribution } from "../api/merge-memory";
import type { MutationCtxAsync } from "../api/merge-memory-async";

export interface DeleteMemoryParams {
  namespace: string;
  key: string;
  attribution?: MemoryMutationAttribution;
}

/**
 * Async variant of {@link deleteMemory}.
 */
export async function deleteMemoryAsync(
  ctx: MutationCtxAsync,
  params: DeleteMemoryParams,
): Promise<void> {
  await runWithOpTelemetryAsync({
    telemetry: ctx.telemetry,
    op: "delete",
    namespace: params.namespace,
    memoryKey: params.key,
    getProvenanceRootHex: async () => (await ctx.persistence.getProvenanceHeadRootHex()) ?? "",
    fn: async () => {
      const { persistence } = ctx;
      const op = buildMemoryOpContext(params.attribution);

      await persistence.withTransaction(async () => {
        const assoc = await persistence.findMemoryAssociation(params.namespace, params.key);
        if (assoc === undefined) {
          return;
        }
        if (assoc.kind === "node") {
          await persistence.clearMemorySubtree(op, {
            memoryKind: "node",
            memoryId: assoc.memoryId,
            nodeId: assoc.nodeId,
          });
          await persistence.deleteMemoryRootRows({
            memoryKind: "node",
            memoryId: assoc.memoryId,
            nodeId: assoc.nodeId,
          });
        } else {
          await persistence.clearMemorySubtree(op, {
            memoryKind: "edge",
            memoryId: assoc.memoryId,
            edgeId: assoc.edgeId,
          });
          await persistence.deleteMemoryRootRows({
            memoryKind: "edge",
            edgeId: assoc.edgeId,
          });
        }
        const { root_hex } = await persistence.appendProvenanceEvent(op, {
          v: 1,
          kind: "DELETE_MEMORY",
          namespace: params.namespace,
          memory_key: params.key,
          memory_id: assoc.memoryId,
          ...(op.contributor !== undefined ? { contributor: op.contributor } : {}),
          ...(op.intentSnapshotId !== undefined ? { intent_snapshot_id: op.intentSnapshotId } : {}),
        });
        await persistence.appendContentOutbox?.(op, {
          root_hex,
          event_type: "DELETE_MEMORY",
          namespace: params.namespace,
          memoryKey: params.key,
          entries: [],
        });
      });
    },
  });
}
