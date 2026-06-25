import { ids } from "@khoralabs/memories-core";
import type { DbCtx } from "../context";
import { ctxExec, ctxQueryOne } from "../db";

export async function ensureNodeLabel(
  ctx: DbCtx,
  input: { kind: string; description?: string; schemaJson?: string | null },
): Promise<string> {
  const description = input.description ?? "";
  const schemaJson =
    input.schemaJson === undefined || input.schemaJson === "" ? null : input.schemaJson;

  const existing = await ctxQueryOne<{ _id: string; schema: string | null }>(
    ctx,
    `SELECT _id, schema FROM node_labels WHERE kind = ?`,
    [input.kind],
  );

  if (existing) {
    if (schemaJson != null && schemaJson !== existing.schema) {
      await ctxExec(ctx, `UPDATE node_labels SET description = ?, schema = ? WHERE _id = ?`, [
        description,
        schemaJson,
        existing._id,
      ]);
    }
    return existing._id;
  }

  const id = ids.nodeLabel(input.kind);
  await ctxExec(
    ctx,
    `INSERT INTO node_labels (_id, _ts_created, kind, description, schema) VALUES (?, ?, ?, ?, ?)`,
    [id, ctx.now, input.kind, description, schemaJson],
  );
  return id;
}
