import { assertNamespacePath, isPrefixOf } from "../../persistence/core";
import { runWithOpTelemetryAsync } from "../../telemetry/index.js";
import { buildMemoryOpContext } from "../api/merge-memory";
import type { MutationCtxAsync } from "../api/merge-memory-async";
import { deleteMemoryAsync } from "./delete-memory-async";
import type { DeleteNamespaceParams, DeleteNamespaceResult } from "./delete-namespace";

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

/** Async variant of {@link deleteNamespace}. */
export async function deleteNamespaceAsync(
  ctx: MutationCtxAsync,
  params: DeleteNamespaceParams,
): Promise<DeleteNamespaceResult> {
  const root = assertNamespacePath(params.namespace);
  const recursive = params.recursive !== false;

  return runWithOpTelemetryAsync({
    telemetry: ctx.telemetry,
    op: "delete",
    namespace: root,
    memoryKey: "*",
    getProvenanceRootHex: async () => (await ctx.persistence.getProvenanceHeadRootHex()) ?? "",
    fn: async () => {
      const listed = (await ctx.persistence.listNamespacesWithMetadata()).map((n) => n.namespace);
      const namespaces = collectTargetNamespaces(listed, root, recursive);
      let deletedMemories = 0;

      for (const ns of namespaces) {
        const keys = await ctx.persistence.listMemoryKeysInNamespace(ns);
        for (const key of keys) {
          await deleteMemoryAsync(ctx, {
            namespace: ns,
            key,
            ...(params.attribution !== undefined ? { attribution: params.attribution } : {}),
          });
          deletedMemories += 1;
        }
      }

      const op = buildMemoryOpContext(params.attribution);
      await ctx.persistence.withTransaction(async () => {
        for (const ns of namespaces) {
          await ctx.persistence.deleteNamespaceMetadata(op, ns);
        }
      });

      return { namespaces, deletedMemories };
    },
  });
}
