import type { MutationCtxAsync } from "../api/merge-memory-async";

export interface DeleteMemoryParams {
  namespace: string;
  key: string;
}

/**
 * Async variant of {@link deleteMemory}.
 */
export async function deleteMemoryAsync(
  ctx: MutationCtxAsync,
  params: DeleteMemoryParams,
): Promise<void> {
  const { persistence } = ctx;
  const now = Date.now();
  const op = { now };

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
    await persistence.appendProvenanceEvent(op, {
      v: 1,
      kind: "DELETE_MEMORY",
      namespace: params.namespace,
      memory_key: params.key,
      memory_id: assoc.memoryId,
    });
  });
}
