import type { MutationCtx } from "../api/merge-memory";

export interface DeleteMemoryParams {
  namespace: string;
  key: string;
}

/**
 * Removes a memory and all dependent data: vector- and lexical-indexed features, source maps,
 * graph edges (node memories) or edge row (edge memories), node label assignments, then root rows.
 * Idempotent when the memory was already absent.
 */
export function deleteMemory(ctx: MutationCtx, params: DeleteMemoryParams): void {
  const { persistence } = ctx;
  const now = Date.now();
  const op = { now };

  persistence.withTransaction(() => {
    const assoc = persistence.findMemoryAssociation(params.namespace, params.key);
    if (assoc === undefined) {
      return;
    }
    if (assoc.kind === "node") {
      persistence.clearMemorySubtree(op, {
        memoryKind: "node",
        memoryId: assoc.memoryId,
        nodeId: assoc.nodeId,
      });
      persistence.deleteMemoryRootRows({
        memoryKind: "node",
        memoryId: assoc.memoryId,
        nodeId: assoc.nodeId,
      });
    } else {
      persistence.clearMemorySubtree(op, {
        memoryKind: "edge",
        memoryId: assoc.memoryId,
        edgeId: assoc.edgeId,
      });
      persistence.deleteMemoryRootRows({
        memoryKind: "edge",
        edgeId: assoc.edgeId,
      });
    }
    const { root_hex } = persistence.appendProvenanceEvent(op, {
      v: 1,
      kind: "DELETE_MEMORY",
      namespace: params.namespace,
      memory_key: params.key,
      memory_id: assoc.memoryId,
    });
    persistence.appendContentOutbox?.(op, {
      root_hex,
      event_type: "DELETE_MEMORY",
      namespace: params.namespace,
      memoryKey: params.key,
      entries: [],
    });
  });
}
