import {
  formatLabelPropsForSearch,
  ids,
  isNonEmptyProps,
  type LabelPropsSearchFormatter,
  MEMORY_EDGE_LABEL_PROPS_KEY_PREFIX,
  MEMORY_NODE_LABEL_PROPS_KEY_PREFIX,
  memoryEdgeLabelPropsSourceKey,
  memoryNodeLabelPropsSourceKey,
  sqlColumnStartsWithPrefix,
} from "../../../../persistence/core";
import type { DbCtx } from "../context";
import { ctxExec, ctxQueryAll, ctxQueryOne } from "../db";
import { parsePropsColumn } from "../sql";
import { insertSourceMap } from "./source-maps";
import { insertLexicalFeature } from "./text-features";

async function deleteSourceMapBySourceKey(
  ctx: DbCtx,
  memoryId: string,
  sourceKey: string,
): Promise<void> {
  const sourceMapId = ids.sourceMap(memoryId, sourceKey);
  const sm = await ctxQueryOne<{ _id: string }>(ctx, `SELECT _id FROM source_maps WHERE _id = ?`, [
    sourceMapId,
  ]);
  if (!sm) return;

  await ctxExec(ctx, `DELETE FROM text_features_fts WHERE source_map_id = ?`, [sourceMapId]);
  await ctxExec(ctx, `DELETE FROM text_features WHERE source_map_id = ?`, [sourceMapId]);
  await ctxExec(ctx, `DELETE FROM vector_features WHERE source_map_id = ?`, [sourceMapId]);
  await ctxExec(ctx, `DELETE FROM source_maps WHERE _id = ?`, [sourceMapId]);
}

export async function removeLabelPropsSearchMaps(ctx: DbCtx, memoryId: string): Promise<void> {
  const rows = await ctxQueryAll<{ source_key: string }>(
    ctx,
    `SELECT source_key FROM source_maps WHERE memory_id = ? AND (
       ${sqlColumnStartsWithPrefix("source_key")}
       OR ${sqlColumnStartsWithPrefix("source_key")}
     )`,
    [
      memoryId,
      MEMORY_NODE_LABEL_PROPS_KEY_PREFIX,
      MEMORY_NODE_LABEL_PROPS_KEY_PREFIX,
      MEMORY_EDGE_LABEL_PROPS_KEY_PREFIX,
      MEMORY_EDGE_LABEL_PROPS_KEY_PREFIX,
    ],
  );
  for (const row of rows) {
    await deleteSourceMapBySourceKey(ctx, memoryId, row.source_key);
  }
}

export async function syncLabelPropsSearchFeatures(
  ctx: DbCtx,
  input: {
    namespace: string;
    memoryKey: string;
    formatLabelProps?: LabelPropsSearchFormatter;
  },
): Promise<void> {
  const { namespace, memoryKey, formatLabelProps } = input;
  const memoryId = ids.memory(namespace, memoryKey);
  const nodeId = ids.node(namespace, memoryKey);

  await removeLabelPropsSearchMaps(ctx, memoryId);

  const memKind = await ctxQueryOne<{ kind: string | null; edge_id: string | null }>(
    ctx,
    `SELECT kind, edge_id FROM memories WHERE _id = ?`,
    [memoryId],
  );
  const kind = memKind?.kind ?? "node";

  if (kind === "edge" && memKind?.edge_id) {
    const edgeRows = await ctxQueryAll<{
      assignmentId: string;
      kind: string;
      propsJson: string | null;
    }>(
      ctx,
      `SELECT ela._id AS assignmentId, el.kind AS kind, ela.props AS propsJson
       FROM edge_label_assignments ela
       JOIN edge_labels el ON el._id = ela.label_id
       WHERE ela.edge_id = ?
       ORDER BY ela._id ASC`,
      [memKind.edge_id],
    );

    for (const row of edgeRows) {
      const props = parsePropsColumn(row.propsJson);
      if (!isNonEmptyProps(props)) continue;
      const text = formatLabelPropsForSearch(row.kind, "edge", props, formatLabelProps);
      if (text.length === 0) continue;
      const sourceKey = memoryEdgeLabelPropsSourceKey(row.assignmentId);
      const { sourceMapId } = await insertSourceMap(ctx, { memoryId, sourceKey });
      await insertLexicalFeature(ctx, { memoryId, sourceMapId, text });
    }
    return;
  }

  const assignmentRows = await ctxQueryAll<{
    assignmentId: string;
    kind: string;
    propsJson: string | null;
  }>(
    ctx,
    `SELECT nla._id AS assignmentId, nl.kind AS kind, nla.props AS propsJson
     FROM node_label_assignments nla
     JOIN node_labels nl ON nl._id = nla.label_id
     WHERE nla.node_id = ?
     ORDER BY nla._id ASC`,
    [nodeId],
  );

  for (const row of assignmentRows) {
    const props = parsePropsColumn(row.propsJson);
    if (!isNonEmptyProps(props)) continue;
    const text = formatLabelPropsForSearch(row.kind, "node", props, formatLabelProps);
    if (text.length === 0) continue;

    const sourceKey = memoryNodeLabelPropsSourceKey(row.assignmentId);
    const { sourceMapId } = await insertSourceMap(ctx, { memoryId, sourceKey });
    await insertLexicalFeature(ctx, { memoryId, sourceMapId, text });
  }
}
