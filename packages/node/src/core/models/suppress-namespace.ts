import { runWithOpTelemetrySync } from "../../telemetry/index.js";
import {
  buildMemoryOpContext,
  type MemoryMutationAttribution,
  type MutationCtx,
} from "../api/merge-memory";

export interface SuppressNamespaceParams {
  namespace: string;
  attribution?: MemoryMutationAttribution;
}

/**
 * Marks a namespace suppressed so it and all descendants are hidden from discovery.
 * Writes may still target the path. Idempotent when this path's metadata flag is already set.
 */
export function suppressNamespace(ctx: MutationCtx, params: SuppressNamespaceParams): void {
  runWithOpTelemetrySync({
    telemetry: ctx.telemetry,
    op: "suppress_namespace",
    namespace: params.namespace,
    getProvenanceRootHex: () => ctx.persistence.getProvenanceHeadRootHex() ?? "",
    fn: () => {
      const { persistence } = ctx;
      const op = buildMemoryOpContext(params.attribution);

      persistence.withTransaction(() => {
        const meta = persistence.getNamespaceMetadata(params.namespace);
        if (meta?.suppressed === true) {
          return;
        }
        persistence.setNamespaceSuppressed(op, {
          namespace: params.namespace,
          suppressed: true,
        });
        persistence.appendProvenanceEvent(op, {
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

/**
 * Clears exact-path namespace suppression. Does not clear child-specific flags.
 * Idempotent when this path is not exactly suppressed.
 */
export function unsuppressNamespace(ctx: MutationCtx, params: SuppressNamespaceParams): void {
  runWithOpTelemetrySync({
    telemetry: ctx.telemetry,
    op: "unsuppress_namespace",
    namespace: params.namespace,
    getProvenanceRootHex: () => ctx.persistence.getProvenanceHeadRootHex() ?? "",
    fn: () => {
      const { persistence } = ctx;
      const op = buildMemoryOpContext(params.attribution);

      persistence.withTransaction(() => {
        const meta = persistence.getNamespaceMetadata(params.namespace);
        if (meta?.suppressed !== true) {
          return;
        }
        persistence.setNamespaceSuppressed(op, {
          namespace: params.namespace,
          suppressed: false,
        });
        persistence.appendProvenanceEvent(op, {
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
