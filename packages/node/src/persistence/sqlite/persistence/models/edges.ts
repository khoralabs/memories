import { ids } from "@khoralabs/memories-persistence-core";
import { memoriesPersistenceDocumentSchema } from "@khoralabs/memories-persistence-core/persistence";
import { documentValidator, jsonOrNull } from "../_lib";
import type { DbCtx } from "./context";

export function insertEdge(
  ctx: DbCtx,
  input: {
    fromNodeId: string;
    toNodeId: string;
    properties?: Record<string, unknown>;
    idParts: { label: string; fromMemoryId: string; toMemoryId: string };
  },
): { edgeId: string } {
  const { now, stmts } = ctx;
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
    _ts_created: now,
    from_node_id: input.fromNodeId,
    to_node_id: input.toNodeId,
    properties: input.properties,
  });
  stmts.insertEdge.run(edgeId, now, input.fromNodeId, input.toNodeId, jsonOrNull(input.properties));
  return { edgeId };
}
