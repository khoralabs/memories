import { ids } from "../../../../persistence/core";
import { memoriesPersistenceDocumentSchema } from "../../../../persistence/core/persistence";
import { documentValidator, jsonOrNull } from "../_lib";
import type { DbCtx } from "./context";

export function upsertNodeForMemoryKey(
  ctx: DbCtx,
  input: {
    namespace: string;
    memoryKey: string;
    memoryId: string;
    properties?: Record<string, unknown>;
  },
): { nodeId: string } {
  const { now, stmts } = ctx;
  const nodeId = ids.node(input.namespace, input.memoryKey);
  const doc = documentValidator(memoriesPersistenceDocumentSchema, "nodes");
  doc.parse({
    _id: nodeId,
    _ts_created: now,
    memory_id: input.memoryId,
    value: input.memoryKey,
    properties: input.properties,
  });
  stmts.upsertNode.run(nodeId, now, input.memoryId, input.memoryKey, jsonOrNull(input.properties));
  return { nodeId };
}

export function nodeExists(ctx: DbCtx, nodeId: string): boolean {
  const row = ctx.db
    .query<{ _id: string }, [string]>(`SELECT _id FROM nodes WHERE _id = ?`)
    .get(nodeId);
  return row != null;
}
