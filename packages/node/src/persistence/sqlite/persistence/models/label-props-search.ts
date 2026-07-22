import {
  formatLabelPropsForSearch,
  ids,
  isNonEmptyProps,
  type LabelPropsSearchFormatter,
  MEMORY_EDGE_LABEL_PROPS_KEY_PREFIX,
  MEMORY_NODE_LABEL_PROPS_KEY_PREFIX,
  memoryEdgeLabelPropsSourceKey,
  memoryNodeLabelPropsSourceKey,
} from "../../../../persistence/core";
import { blobToVector } from "../connection";
import type { DbCtx } from "./context";
import { insertSourceMap } from "./source-maps";
import { insertLexicalFeature } from "./text-features";

function parsePropsColumn(raw: unknown): Record<string, unknown> {
  if (raw == null || raw === "") return {};
  if (typeof raw === "string") {
    try {
      const o = JSON.parse(raw) as unknown;
      if (o && typeof o === "object" && !Array.isArray(o)) return o as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

function deleteVectorRowAndVecIndex(
  ctx: DbCtx,
  vectorFeatureId: string,
  vectorBlob: Buffer | Uint8Array,
): void {
  const floats = blobToVector(
    vectorBlob instanceof Buffer ? new Uint8Array(vectorBlob) : vectorBlob,
  );
  const dim = floats.length;
  if (dim < 512 || dim > 3072) return;
  ctx.stmts.getDeleteVectorVecByFeatureId(dim).run(vectorFeatureId);
  ctx.stmts.deleteVectorFeaturesByFeatureId.run(vectorFeatureId);
}

function deleteSourceMapBySourceKey(ctx: DbCtx, memoryId: string, sourceKey: string): void {
  const { db, stmts } = ctx;
  const sourceMapId = ids.sourceMap(memoryId, sourceKey);
  const sm = db
    .query<{ _id: string }, [string]>(`SELECT _id FROM source_maps WHERE _id = ?`)
    .get(sourceMapId);
  if (!sm) return;

  const textFeatureId = ids.textFeature(sourceMapId);
  stmts.deleteTextFeaturesFtsByTextFeatureId.run(textFeatureId);
  stmts.deleteTextFeaturesFtsBySourceMapId.run(sourceMapId);
  stmts.deleteTextFeaturesBySourceMapId.run(sourceMapId);

  const vfRows = db
    .query<{ _id: string; vector: Buffer | Uint8Array }, [string]>(
      `SELECT _id, vector FROM vector_features WHERE source_map_id = ?`,
    )
    .all(sourceMapId);
  for (const row of vfRows) {
    deleteVectorRowAndVecIndex(ctx, row._id, row.vector);
  }

  stmts.deleteSourceMapById.run(sourceMapId);
}

/** Remove all label-props FTS chunks for a memory before rebuilding. */
export function removeLabelPropsSearchMaps(ctx: DbCtx, memoryId: string): void {
  const rows = ctx.db
    .query<{ source_key: string }, [string, string, string]>(
      `SELECT source_key FROM source_maps WHERE memory_id = ? AND (
         source_key LIKE ? OR source_key LIKE ?
       )`,
    )
    .all(
      memoryId,
      `${MEMORY_NODE_LABEL_PROPS_KEY_PREFIX}%`,
      `${MEMORY_EDGE_LABEL_PROPS_KEY_PREFIX}%`,
    );
  for (const row of rows) {
    deleteSourceMapBySourceKey(ctx, memoryId, row.source_key);
  }
}

/**
 * Rebuild FTS chunks for ontology props on node labels and incident edge labels.
 * Topology meta (`__mem_search_meta__`) is unchanged; call after {@link syncMemorySearchMeta}.
 */
export function syncLabelPropsSearchFeatures(
  ctx: DbCtx,
  input: {
    namespace: string;
    memoryKey: string;
    formatLabelProps?: LabelPropsSearchFormatter;
  },
): void {
  const { namespace, memoryKey, formatLabelProps } = input;
  const memoryId = ids.memory(namespace, memoryKey);
  const nodeId = ids.node(namespace, memoryKey);

  removeLabelPropsSearchMaps(ctx, memoryId);

  const memKind = ctx.db
    .query<{ kind: string | null; edge_id: string | null }, [string]>(
      `SELECT kind, edge_id FROM memories WHERE _id = ?`,
    )
    .get(memoryId);
  const kind = memKind?.kind ?? "node";

  if (kind === "edge" && memKind?.edge_id) {
    const edgeRows = ctx.db
      .query<{ assignmentId: string; kind: string; propsJson: string | null }, [string]>(
        `SELECT ela._id AS assignmentId, el.kind AS kind, ela.props AS propsJson
         FROM edge_label_assignments ela
         JOIN edge_labels el ON el._id = ela.label_id
         WHERE ela.edge_id = ?
         ORDER BY ela._id ASC`,
      )
      .all(memKind.edge_id);

    for (const row of edgeRows) {
      const props = parsePropsColumn(row.propsJson);
      if (!isNonEmptyProps(props)) continue;
      const text = formatLabelPropsForSearch(row.kind, "edge", props, formatLabelProps);
      if (text.length === 0) continue;
      const sourceKey = memoryEdgeLabelPropsSourceKey(row.assignmentId);
      const { sourceMapId } = insertSourceMap(ctx, { memoryId, sourceKey });
      insertLexicalFeature(ctx, { memoryId, sourceMapId, text });
    }
    return;
  }

  const assignmentRows = ctx.db
    .query<{ assignmentId: string; kind: string; propsJson: string | null }, [string]>(
      `SELECT nla._id AS assignmentId, nl.kind AS kind, nla.props AS propsJson
       FROM node_label_assignments nla
       JOIN node_labels nl ON nl._id = nla.label_id
       WHERE nla.node_id = ?
       ORDER BY nla._id ASC`,
    )
    .all(nodeId);

  for (const row of assignmentRows) {
    const props = parsePropsColumn(row.propsJson);
    if (!isNonEmptyProps(props)) continue;
    const text = formatLabelPropsForSearch(row.kind, "node", props, formatLabelProps);
    if (text.length === 0) continue;

    const sourceKey = memoryNodeLabelPropsSourceKey(row.assignmentId);
    const { sourceMapId } = insertSourceMap(ctx, { memoryId, sourceKey });
    insertLexicalFeature(ctx, { memoryId, sourceMapId, text });
  }
}
