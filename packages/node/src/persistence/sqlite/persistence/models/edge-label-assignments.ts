import { ids } from "../../../../persistence/core";
import type { DbCtx } from "./context";
import { validatePropsAgainstJsonSchema } from "./validate-props";

function serializeProps(props: Record<string, unknown>): string {
  return JSON.stringify(props ?? {});
}

export function insertEdgeLabelAssignment(
  ctx: DbCtx,
  input: { edgeId: string; labelId: string; props: Record<string, unknown> },
): void {
  const { db, now, stmts } = ctx;
  const schemaRow = db
    .query<{ schema: string | null }, [string]>(`SELECT schema FROM edge_labels WHERE _id = ?`)
    .get(input.labelId);
  validatePropsAgainstJsonSchema(schemaRow?.schema ?? null, input.props);

  const assignmentId = ids.edgeLabelAssignment(input.edgeId, input.labelId);
  const propsJson = serializeProps(input.props);
  stmts.insertEdgeLabelAssignment.run(assignmentId, now, input.edgeId, input.labelId, propsJson);
}
