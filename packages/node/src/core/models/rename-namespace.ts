import { assertNamespacePath } from "../../persistence/core";
import {
  buildRenameNamespaceMap,
  collectRenameSourceNamespaces,
} from "../../persistence/core/models/rename-namespace-plan";
import { runWithOpTelemetrySync } from "../../telemetry/index.js";
import {
  buildMemoryOpContext,
  type MemoryMutationAttribution,
  type MutationCtx,
} from "../api/merge-memory";

export type RenameNamespaceParams = {
  from: string;
  to: string;
  /** When true (default), rename `from` and all descendant paths. */
  recursive?: boolean;
  attribution?: MemoryMutationAttribution;
};

export type RenameNamespaceResult = {
  namespaces: Array<{ from: string; to: string }>;
  renamedMemories: number;
};

/**
 * Literal path rename: rematerializes deterministic ids under the new path(s).
 * Fails if any `(newNamespace, key)` already exists outside the rename set.
 * Emits one `RENAME_NAMESPACE` provenance event. Does not rewrite history.
 */
export function renameNamespace(
  ctx: MutationCtx,
  params: RenameNamespaceParams,
): RenameNamespaceResult {
  const from = assertNamespacePath(params.from);
  const to = assertNamespacePath(params.to);
  const recursive = params.recursive !== false;

  return runWithOpTelemetrySync({
    telemetry: ctx.telemetry,
    op: "merge",
    namespace: from,
    memoryKey: "*",
    getProvenanceRootHex: () => ctx.persistence.getProvenanceHeadRootHex() ?? "",
    fn: () => {
      if (from === to) {
        return { namespaces: [], renamedMemories: 0 };
      }

      const listed = ctx.persistence.listNamespacesWithMetadata().map((n) => n.namespace);
      const sources = collectRenameSourceNamespaces(listed, from, recursive);
      const nsMap = buildRenameNamespaceMap(sources, from, to);

      for (const [oldNs, newNs] of nsMap) {
        for (const key of ctx.persistence.listMemoryKeysInNamespace(oldNs)) {
          const existingId = ctx.persistence.findMemoryIdByKey(newNs, key);
          if (existingId === undefined) continue;
          const loc = ctx.persistence.loadMemoryNamespaceKey(existingId);
          if (loc === undefined || nsMap.has(loc.namespace)) continue;
          throw new Error(
            `namespace rename collision: key ${JSON.stringify(key)} already exists at ${newNs}`,
          );
        }
      }

      const op = buildMemoryOpContext(params.attribution);
      let renamedMemories = 0;
      ctx.persistence.withTransaction(() => {
        const result = ctx.persistence.renameNamespacePaths(op, { nsMap });
        renamedMemories = result.renamedMemories;
        ctx.persistence.appendProvenanceEvent(op, {
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
