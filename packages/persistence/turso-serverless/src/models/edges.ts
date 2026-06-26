import { ids } from "@khoralabs/memories-persistence-core";
import { memoriesPersistenceDocumentSchema } from "@khoralabs/memories-persistence-core/persistence";
import { documentValidator, jsonOrNull } from "../_lib";
import type { DbCtx } from "../context";
import { ctxExec } from "../db";

export async function insertEdge(
  ctx: DbCtx,
  input: {
    fromNodeId: string;
    toNodeId: string;
    properties?: Record<string, unknown>;
    idParts: { label: string; fromMemoryId: string; toMemoryId: string };
  },
): Promise<{ edgeId: string }> {
  const edgeId = ids.edge(
    input.fromNodeId,
    input.toNodeId,
    input.idParts.label,
    input.idParts.fromMemoryId,
    input.idParts.toMemoryId,
  );
  const doc = documentValidator(memoriesPersistenceDocumentSchema, "edges");
  doc.parse({
    _id: edgeId,
    _ts_created: ctx.now,
    from_node_id: input.fromNodeId,
    to_node_id: input.toNodeId,
    properties: input.properties,
  });
  await ctxExec(
    ctx,
    `INSERT OR REPLACE INTO edges (_id, _ts_created, from_node_id, to_node_id, properties) VALUES (?, ?, ?, ?, ?)`,
    [edgeId, ctx.now, input.fromNodeId, input.toNodeId, jsonOrNull(input.properties)],
  );
  return { edgeId };
}
