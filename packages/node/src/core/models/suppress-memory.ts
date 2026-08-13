import { runWithOpTelemetrySync } from "../../telemetry/index.js";
import {
  buildMemoryOpContext,
  type MemoryMutationAttribution,
  type MutationCtx,
} from "../api/merge-memory";

export interface SuppressMemoryParams {
  namespace: string;
  key: string;
  attribution?: MemoryMutationAttribution;
}

/** Apply suppress mutations; caller must already be inside {@link MemoriesPersistence.withTransaction}. */
export function suppressMemoryInTransaction(ctx: MutationCtx, params: SuppressMemoryParams): void {
  const { persistence } = ctx;
  const op = buildMemoryOpContext(params.attribution);
  const assoc = persistence.findMemoryAssociation(params.namespace, params.key);
  if (assoc === undefined) return;
  if (persistence.isMemorySuppressed(assoc.memoryId)) return;
  persistence.setMemorySuppressed(op, { memoryId: assoc.memoryId, suppressed: true });
  persistence.appendProvenanceEvent(op, {
    v: 1,
    kind: "SUPPRESS_MEMORY",
    namespace: params.namespace,
    memory_key: params.key,
    memory_id: assoc.memoryId,
    ...(op.contributor !== undefined ? { contributor: op.contributor } : {}),
    ...(op.intentSnapshotId !== undefined ? { intent_snapshot_id: op.intentSnapshotId } : {}),
  });
}

/**
 * Marks a memory suppressed so it (and edges incident to a suppressed node) are hidden from
 * search/graph discovery. Rows remain; idempotent when already suppressed (no provenance append).
 */
export function suppressMemory(ctx: MutationCtx, params: SuppressMemoryParams): void {
  runWithOpTelemetrySync({
    telemetry: ctx.telemetry,
    op: "suppress",
    namespace: params.namespace,
    memoryKey: params.key,
    getProvenanceRootHex: () => ctx.persistence.getProvenanceHeadRootHex() ?? "",
    fn: () => {
      ctx.persistence.withTransaction(() => {
        suppressMemoryInTransaction(ctx, params);
      });
    },
  });
}

/**
 * Clears suppression so the memory can surface in search/graph again.
 * Idempotent when not suppressed (no provenance append).
 */
export function unsuppressMemory(ctx: MutationCtx, params: SuppressMemoryParams): void {
  runWithOpTelemetrySync({
    telemetry: ctx.telemetry,
    op: "unsuppress",
    namespace: params.namespace,
    memoryKey: params.key,
    getProvenanceRootHex: () => ctx.persistence.getProvenanceHeadRootHex() ?? "",
    fn: () => {
      const { persistence } = ctx;
      const op = buildMemoryOpContext(params.attribution);

      persistence.withTransaction(() => {
        const assoc = persistence.findMemoryAssociation(params.namespace, params.key);
        if (assoc === undefined) {
          return;
        }
        if (!persistence.isMemorySuppressed(assoc.memoryId)) {
          return;
        }
        persistence.setMemorySuppressed(op, { memoryId: assoc.memoryId, suppressed: false });
        persistence.appendProvenanceEvent(op, {
          v: 1,
          kind: "UNSUPPRESS_MEMORY",
          namespace: params.namespace,
          memory_key: params.key,
          memory_id: assoc.memoryId,
          ...(op.contributor !== undefined ? { contributor: op.contributor } : {}),
          ...(op.intentSnapshotId !== undefined ? { intent_snapshot_id: op.intentSnapshotId } : {}),
        });
      });
    },
  });
}
