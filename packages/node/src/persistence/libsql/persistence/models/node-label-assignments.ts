import { ids } from "../../../../persistence/core";
import type { DbCtx } from "../context";
import { ctxExec, ctxQueryOne } from "../db";
import { validatePropsAgainstJsonSchema } from "./validate-props";

function serializeProps(props: Record<string, unknown>): string {
  return JSON.stringify(props ?? {});
}

export async function insertNodeLabelAssignment(
  ctx: DbCtx,
  input: { nodeId: string; labelId: string; props: Record<string, unknown> },
): Promise<void> {
  const schemaRow = await ctxQueryOne<{ schema: string | null }>(
    ctx,
    `SELECT schema FROM node_labels WHERE _id = ?`,
    [input.labelId],
  );
  validatePropsAgainstJsonSchema(schemaRow?.schema ?? null, input.props);

  const assignmentId = ids.nodeLabelAssignment(input.nodeId, input.labelId);
  await ctxExec(
    ctx,
    `INSERT OR REPLACE INTO node_label_assignments (_id, _ts_created, node_id, label_id, props) VALUES (?, ?, ?, ?, ?)`,
    [assignmentId, ctx.now, input.nodeId, input.labelId, serializeProps(input.props)],
  );
}
