import { runWithOpTelemetryAsync } from "../../telemetry/index.js";
import { buildMemoryOpContext } from "../api/merge-memory";
import type { MutationCtxAsync } from "../api/merge-memory-async";
import type { SuppressMemoryParams } from "./suppress-memory";

/**
 * Async variant of {@link suppressMemory}.
 */
export async function suppressMemoryAsync(
  ctx: MutationCtxAsync,
  params: SuppressMemoryParams,
): Promise<void> {
  await runWithOpTelemetryAsync({
    telemetry: ctx.telemetry,
    op: "suppress",
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
        if (await persistence.isMemorySuppressed(assoc.memoryId)) {
          return;
        }
        await persistence.setMemorySuppressed(op, {
          memoryId: assoc.memoryId,
          suppressed: true,
        });
        const { root_hex } = await persistence.appendProvenanceEvent(op, {
          v: 1,
          kind: "SUPPRESS_MEMORY",
          namespace: params.namespace,
          memory_key: params.key,
          memory_id: assoc.memoryId,
          ...(op.contributor !== undefined ? { contributor: op.contributor } : {}),
          ...(op.intentSnapshotId !== undefined ? { intent_snapshot_id: op.intentSnapshotId } : {}),
        });
        await persistence.appendGraphFacetOutbox?.(op, {
          root_hex,
          event_type: "SUPPRESS_MEMORY",
          namespace: params.namespace,
          memoryKey: params.key,
          edgeId: assoc.kind === "edge" ? assoc.edgeId : null,
        });
      });
    },
  });
}

/**
 * Async variant of {@link unsuppressMemory}.
 */
export async function unsuppressMemoryAsync(
  ctx: MutationCtxAsync,
  params: SuppressMemoryParams,
): Promise<void> {
  await runWithOpTelemetryAsync({
    telemetry: ctx.telemetry,
    op: "unsuppress",
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
        if (!(await persistence.isMemorySuppressed(assoc.memoryId))) {
          return;
        }
        await persistence.setMemorySuppressed(op, {
          memoryId: assoc.memoryId,
          suppressed: false,
        });
        const { root_hex } = await persistence.appendProvenanceEvent(op, {
          v: 1,
          kind: "UNSUPPRESS_MEMORY",
          namespace: params.namespace,
          memory_key: params.key,
          memory_id: assoc.memoryId,
          ...(op.contributor !== undefined ? { contributor: op.contributor } : {}),
          ...(op.intentSnapshotId !== undefined ? { intent_snapshot_id: op.intentSnapshotId } : {}),
        });
        await persistence.appendGraphFacetOutbox?.(op, {
          root_hex,
          event_type: "UNSUPPRESS_MEMORY",
          namespace: params.namespace,
          memoryKey: params.key,
          edgeId: assoc.kind === "edge" ? assoc.edgeId : null,
        });
      });
    },
  });
}
