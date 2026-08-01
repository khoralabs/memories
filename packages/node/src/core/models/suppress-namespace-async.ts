import { runWithOpTelemetryAsync } from "../../telemetry/index.js";
import { buildMemoryOpContext } from "../api/merge-memory";
import type { MutationCtxAsync } from "../api/merge-memory-async";
import type { SuppressNamespaceParams } from "./suppress-namespace";

/** Async variant of {@link suppressNamespace}. */
export async function suppressNamespaceAsync(
  ctx: MutationCtxAsync,
  params: SuppressNamespaceParams,
): Promise<void> {
  await runWithOpTelemetryAsync({
    telemetry: ctx.telemetry,
    op: "suppress_namespace",
    namespace: params.namespace,
    getProvenanceRootHex: async () => (await ctx.persistence.getProvenanceHeadRootHex()) ?? "",
    fn: async () => {
      const { persistence } = ctx;
      const op = buildMemoryOpContext(params.attribution);

      await persistence.withTransaction(async () => {
        const meta = await persistence.getNamespaceMetadata(params.namespace);
        if (meta?.suppressed === true) {
          return;
        }
        await persistence.setNamespaceSuppressed(op, {
          namespace: params.namespace,
          suppressed: true,
        });
        await persistence.appendProvenanceEvent(op, {
          v: 1,
          kind: "SUPPRESS_NAMESPACE",
          namespace: params.namespace,
          ...(op.contributor !== undefined ? { contributor: op.contributor } : {}),
          ...(op.intentSnapshotId !== undefined ? { intent_snapshot_id: op.intentSnapshotId } : {}),
        });
      });
    },
  });
}

/** Async variant of {@link unsuppressNamespace}. */
export async function unsuppressNamespaceAsync(
  ctx: MutationCtxAsync,
  params: SuppressNamespaceParams,
): Promise<void> {
  await runWithOpTelemetryAsync({
    telemetry: ctx.telemetry,
    op: "unsuppress_namespace",
    namespace: params.namespace,
    getProvenanceRootHex: async () => (await ctx.persistence.getProvenanceHeadRootHex()) ?? "",
    fn: async () => {
      const { persistence } = ctx;
      const op = buildMemoryOpContext(params.attribution);

      await persistence.withTransaction(async () => {
        const meta = await persistence.getNamespaceMetadata(params.namespace);
        if (meta?.suppressed !== true) {
          return;
        }
        await persistence.setNamespaceSuppressed(op, {
          namespace: params.namespace,
          suppressed: false,
        });
        await persistence.appendProvenanceEvent(op, {
          v: 1,
          kind: "UNSUPPRESS_NAMESPACE",
          namespace: params.namespace,
          ...(op.contributor !== undefined ? { contributor: op.contributor } : {}),
          ...(op.intentSnapshotId !== undefined ? { intent_snapshot_id: op.intentSnapshotId } : {}),
        });
      });
    },
  });
}
