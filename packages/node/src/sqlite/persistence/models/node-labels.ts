import { ids } from "@khoralabs/memories-persistence-core";
import type { DbCtx } from "./context";

/** Returns `_id` for a `node_labels` row (catalog kind), inserting when missing. */
export function ensureNodeLabel(
  ctx: DbCtx,
  input: { kind: string; description?: string; schemaJson?: string | null },
): string {
  const { db, now, stmts } = ctx;
  const description = input.description ?? "";
  const schemaJson =
    input.schemaJson === undefined || input.schemaJson === "" ? null : input.schemaJson;

  const existing = db
    .query<{ _id: string; schema: string | null }, [string]>(
      `SELECT _id, schema FROM node_labels WHERE kind = ?`,
    )
    .get(input.kind);

  if (existing) {
    if (schemaJson != null && schemaJson !== existing.schema) {
      stmts.updateNodeLabel.run(description, schemaJson, existing._id);
    }
    return existing._id;
  }

  const id = ids.nodeLabel(input.kind);
  stmts.insertNodeLabel.run(id, now, input.kind, description, schemaJson);
  return id;
}
