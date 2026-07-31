import { assertNamespacePath } from "../../persistence/core";
import {
  buildRenameNamespaceMap,
  collectRenameSourceNamespaces,
} from "../../persistence/core/models/rename-namespace-plan";
import { runWithOpTelemetryAsync } from "../../telemetry/index.js";
import { buildMemoryOpContext } from "../api/merge-memory";
import type { MutationCtxAsync } from "../api/merge-memory-async";
import type { RenameNamespaceParams, RenameNamespaceResult } from "./rename-namespace";

/** Async variant of {@link renameNamespace}. */
export async function renameNamespaceAsync(
  ctx: MutationCtxAsync,
  params: RenameNamespaceParams,
): Promise<RenameNamespaceResult> {
  const from = assertNamespacePath(params.from);
  const to = assertNamespacePath(params.to);
  const recursive = params.recursive !== false;

  return runWithOpTelemetryAsync({
    telemetry: ctx.telemetry,
    op: "merge",
    namespace: from,
    memoryKey: "*",
    getProvenanceRootHex: async () => (await ctx.persistence.getProvenanceHeadRootHex()) ?? "",
    fn: async () => {
      if (from === to) {
        return { namespaces: [], renamedMemories: 0 };
      }

      const listed = (await ctx.persistence.listNamespacesWithMetadata()).map((n) => n.namespace);
      const sources = collectRenameSourceNamespaces(listed, from, recursive);
      const nsMap = buildRenameNamespaceMap(sources, from, to);

      for (const [oldNs, newNs] of nsMap) {
        for (const key of await ctx.persistence.listMemoryKeysInNamespace(oldNs)) {
          const existingId = await ctx.persistence.findMemoryIdByKey(newNs, key);
          if (existingId === undefined) continue;
          const loc = await ctx.persistence.loadMemoryNamespaceKey(existingId);
          if (loc === undefined || nsMap.has(loc.namespace)) continue;
          throw new Error(
            `namespace rename collision: key ${JSON.stringify(key)} already exists at ${newNs}`,
          );
        }
      }

      const op = buildMemoryOpContext(params.attribution);
      let renamedMemories = 0;
      await ctx.persistence.withTransaction(async () => {
        const result = await ctx.persistence.renameNamespacePaths(op, { nsMap });
        renamedMemories = result.renamedMemories;
        await ctx.persistence.appendProvenanceEvent(op, {
          v: 1,
          kind: "RENAME_NAMESPACE",
          from_namespace: from,
          to_namespace: to,
          recursive,
          ...(params.attribution?.contributor !== undefined
            ? { contributor: params.attribution.contributor }
            : {}),
          ...(params.attribution?.intentSnapshotId !== undefined
            ? { intent_snapshot_id: params.attribution.intentSnapshotId }
            : {}),
        });
      });

      return {
        namespaces: [...nsMap.entries()].map(([f, t]) => ({ from: f, to: t })),
        renamedMemories,
      };
    },
  });
}
