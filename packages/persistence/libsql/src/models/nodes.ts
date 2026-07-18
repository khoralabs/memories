import { ids } from "@khoralabs/memories-persistence-core";
import { memoriesPersistenceDocumentSchema } from "@khoralabs/memories-persistence-core/persistence";
import { documentValidator, jsonOrNull } from "../_lib";
import type { DbCtx } from "../context";
import { ctxExec, ctxQueryOne } from "../db";

export async function upsertNodeForMemoryKey(
  ctx: DbCtx,
  input: {
    namespace: string;
    memoryKey: string;
    memoryId: string;
    properties?: Record<string, unknown>;
  },
): Promise<{ nodeId: string }> {
  const nodeId = ids.node(input.namespace, input.memoryKey);
  const doc = documentValidator(memoriesPersistenceDocumentSchema, "nodes");
  doc.parse({
    _id: nodeId,
    _ts_created: ctx.now,
    memory_id: input.memoryId,
    value: input.memoryKey,
    properties: input.properties,
  });
  await ctxExec(
    ctx,
    `INSERT INTO nodes (_id, _ts_created, memory_id, value, properties) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(_id) DO UPDATE SET memory_id = excluded.memory_id, value = excluded.value, properties = excluded.properties`,
    [nodeId, ctx.now, input.memoryId, input.memoryKey, jsonOrNull(input.properties)],
  );
  return { nodeId };
}

export async function nodeExists(ctx: DbCtx, nodeId: string): Promise<boolean> {
  const row = await ctxQueryOne<{ _id: string }>(ctx, `SELECT _id FROM nodes WHERE _id = ?`, [
    nodeId,
  ]);
  return row != null;
}
