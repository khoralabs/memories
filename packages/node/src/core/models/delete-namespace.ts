import { assertNamespacePath, isPrefixOf } from "../../persistence/core";
import { runWithOpTelemetrySync } from "../../telemetry/index.js";
import {
  buildMemoryOpContext,
  type MemoryMutationAttribution,
  type MutationCtx,
} from "../api/merge-memory";
import { deleteMemory } from "./delete-memory";

export type DeleteNamespaceParams = {
  namespace: string;
  /** When true (default), delete `namespace` and all descendant paths. */
  recursive?: boolean;
  attribution?: MemoryMutationAttribution;
};

export type DeleteNamespaceResult = {
  namespaces: string[];
  deletedMemories: number;
};

function collectTargetNamespaces(
  listed: readonly string[],
  root: string,
  recursive: boolean,
): string[] {
  if (!recursive) return [root];
  const targets = new Set<string>([root]);
  for (const n of listed) {
    if (isPrefixOf(root, n)) targets.add(n);
  }
  return [...targets].sort((a, b) => b.length - a.length || a.localeCompare(b));
}

/**
 * Deletes all memories under a namespace (and descendants when recursive), then metadata rows.
 * Idempotent for missing namespaces. Emits one DELETE_MEMORY provenance event per memory.
 */
export function deleteNamespace(
  ctx: MutationCtx,
  params: DeleteNamespaceParams,
): DeleteNamespaceResult {
  const root = assertNamespacePath(params.namespace);
  const recursive = params.recursive !== false;

  return runWithOpTelemetrySync({
    telemetry: ctx.telemetry,
    op: "delete",
    namespace: root,
    memoryKey: "*",
    getProvenanceRootHex: () => ctx.persistence.getProvenanceHeadRootHex() ?? "",
    fn: () => {
      const listed = ctx.persistence.listNamespacesWithMetadata().map((n) => n.namespace);
      const namespaces = collectTargetNamespaces(listed, root, recursive);
      let deletedMemories = 0;

      for (const ns of namespaces) {
        const keys = ctx.persistence.listMemoryKeysInNamespace(ns);
        for (const key of keys) {
          deleteMemory(ctx, {
            namespace: ns,
            key,
            ...(params.attribution !== undefined ? { attribution: params.attribution } : {}),
          });
          deletedMemories += 1;
        }
      }

      const op = buildMemoryOpContext(params.attribution);
      ctx.persistence.withTransaction(() => {
        for (const ns of namespaces) {
          ctx.persistence.deleteNamespaceMetadata(op, ns);
        }
      });

      return { namespaces, deletedMemories };
    },
  });
}
