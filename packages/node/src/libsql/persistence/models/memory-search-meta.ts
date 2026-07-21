import {
  ids,
  isSystemSearchMetaSourceKey,
  MEMORY_SEARCH_META_SOURCE_KEY,
} from "@khoralabs/memories-persistence-core";
import type { DbCtx } from "../context";
import { ctxExec, ctxQueryAll, ctxQueryOne } from "../db";
import { loadGraphEdge } from "./graph-index";
import { insertSourceMap } from "./source-maps";
import { insertLexicalFeature } from "./text-features";
import { insertVectorFeature } from "./vector-features";

export { isSystemSearchMetaSourceKey, MEMORY_SEARCH_META_SOURCE_KEY };

const EDGE_LABEL_SEP = String.fromCharCode(31);

function sortUnique(xs: string[]): string[] {
  return [...new Set(xs)].sort((a, b) => a.localeCompare(b));
}

function formatNodeLines(labels: string[]): string[] {
  return sortUnique(labels).map((l) => `node:${l}`);
}

function formatEdgeLine(
  direction: "in" | "out",
  neighborKey: string,
  edgeLabels: string[],
): string {
  const joined = sortUnique(edgeLabels).join("|");
  return `edge ${direction}:${neighborKey}:${joined}`;
}

export async function listNeighborMemoriesForNode(
  ctx: DbCtx,
  _namespace: string,
  nodeId: string,
): Promise<Array<{ namespace: string; key: string }>> {
  const rows = await ctxQueryAll<{ namespace: string; key: string }>(
    ctx,
    `SELECT DISTINCT m.namespace AS namespace, m.key AS key
     FROM edges e
     JOIN nodes n_other ON n_other._id = CASE
       WHEN e.from_node_id = ? THEN e.to_node_id
       ELSE e.from_node_id
     END
     JOIN memories m ON m._id = n_other.memory_id
     WHERE e.from_node_id = ? OR e.to_node_id = ?`,
    [nodeId, nodeId, nodeId],
  );
  const out = new Map<string, { namespace: string; key: string }>();
  for (const r of rows) {
    out.set(`${r.namespace}\0${r.key}`, { namespace: r.namespace, key: r.key });
  }
  return [...out.values()].sort((a, b) =>
    a.namespace !== b.namespace
      ? a.namespace.localeCompare(b.namespace)
      : a.key.localeCompare(b.key),
  );
}

export function parseEdgeLabelsJoined(s: string | null): string[] {
  if (!s) return [];
  return sortUnique(s.split(EDGE_LABEL_SEP).filter(Boolean));
}

export async function collectEdgesFromDb(
  ctx: DbCtx,
  nodeId: string,
  _namespace: string,
): Promise<
  Array<{
    edgeId: string;
    neighborKey: string;
    direction: "in" | "out";
    labelsJoined: string | null;
  }>
> {
  const rows = await ctxQueryAll<{
    edgeId: string;
    neighborKey: string;
    direction: string;
    labelsJoined: string | null;
  }>(
    ctx,
    `SELECT
       e._id AS edgeId,
       n_other.value AS neighborKey,
       CASE WHEN e.from_node_id = ? THEN 'out' ELSE 'in' END AS direction,
       GROUP_CONCAT(el.kind, CHAR(31)) AS labelsJoined
     FROM edges e
     JOIN nodes n_other ON n_other._id = CASE
       WHEN e.from_node_id = ? THEN e.to_node_id
       ELSE e.from_node_id
     END
     JOIN memories m ON m._id = n_other.memory_id
     LEFT JOIN edge_label_assignments ela ON ela.edge_id = e._id
     LEFT JOIN edge_labels el ON el._id = ela.label_id
     WHERE e.from_node_id = ? OR e.to_node_id = ?
     GROUP BY e._id, n_other.value, CASE WHEN e.from_node_id = ? THEN 'out' ELSE 'in' END
     ORDER BY e._id ASC`,
    [nodeId, nodeId, nodeId, nodeId, nodeId],
  );
  return rows.map((r) => ({
    edgeId: r.edgeId,
    neighborKey: r.neighborKey,
    direction: r.direction === "out" ? ("out" as const) : ("in" as const),
    labelsJoined: r.labelsJoined,
  }));
}

async function collectNodeLabelsFromDb(ctx: DbCtx, nodeId: string): Promise<string[]> {
  const rows = await ctxQueryAll<{ label: string }>(
    ctx,
    `SELECT nl.kind AS label
     FROM node_label_assignments nla
     JOIN node_labels nl ON nl._id = nla.label_id
     WHERE nla.node_id = ?
     ORDER BY nl.kind ASC`,
    [nodeId],
  );
  return rows.map((r) => r.label);
}

export async function buildCanonicalMemorySearchMetaText(
  ctx: DbCtx,
  namespace: string,
  memoryKey: string,
): Promise<string> {
  const memoryId = ids.memory(namespace, memoryKey);
  const mk = await ctxQueryOne<{ kind: string | null; edge_id: string | null }>(
    ctx,
    `SELECT kind, edge_id FROM memories WHERE _id = ?`,
    [memoryId],
  );
  const kind = mk?.kind ?? "node";
  if (kind === "edge" && mk?.edge_id) {
    const link = await loadGraphEdge(ctx, namespace, mk.edge_id);
    if (!link) return "";
    const edgeKinds = link.labels.map((l) => l.kind).sort((a, b) => a.localeCompare(b));
    return `edge_memory:${link.fromKey}<->${link.toKey}:${edgeKinds.join("|")}`;
  }
  const nodeId = ids.node(namespace, memoryKey);
  const labels = await collectNodeLabelsFromDb(ctx, nodeId);
  const nodeLines = formatNodeLines(labels);
  const edgeRows = await collectEdgesFromDb(ctx, nodeId, namespace);
  const edgeLines = edgeRows.map((r) =>
    formatEdgeLine(r.direction, r.neighborKey, parseEdgeLabelsJoined(r.labelsJoined)),
  );
  const lines = [...nodeLines, ...edgeLines].sort((a, b) => a.localeCompare(b));
  return lines.join("\n");
}

export async function removeMemorySearchMeta(ctx: DbCtx, memoryId: string): Promise<void> {
  const sourceMapId = ids.sourceMap(memoryId, MEMORY_SEARCH_META_SOURCE_KEY);
  const sm = await ctxQueryOne<{ _id: string }>(ctx, `SELECT _id FROM source_maps WHERE _id = ?`, [
    sourceMapId,
  ]);
  if (!sm) return;

  await ctxExec(ctx, `DELETE FROM text_features_fts WHERE source_map_id = ?`, [sourceMapId]);
  await ctxExec(ctx, `DELETE FROM text_features WHERE source_map_id = ?`, [sourceMapId]);
  await ctxExec(ctx, `DELETE FROM vector_features WHERE source_map_id = ?`, [sourceMapId]);
  await ctxExec(ctx, `DELETE FROM source_maps WHERE _id = ?`, [sourceMapId]);
}

export async function syncMemorySearchMeta(
  ctx: DbCtx,
  input: {
    namespace: string;
    memoryKey: string;
    metaVector?: Float32Array;
  },
): Promise<void> {
  const memoryId = ids.memory(input.namespace, input.memoryKey);
  const text = await buildCanonicalMemorySearchMetaText(ctx, input.namespace, input.memoryKey);
  await removeMemorySearchMeta(ctx, memoryId);
  if (text.length === 0) return;

  const { sourceMapId } = await insertSourceMap(ctx, {
    memoryId,
    sourceKey: MEMORY_SEARCH_META_SOURCE_KEY,
  });
  await insertLexicalFeature(ctx, { memoryId, sourceMapId, text });
  if (input.metaVector !== undefined && input.metaVector.length > 0) {
    await insertVectorFeature(ctx, {
      memoryId,
      sourceMapId,
      vector: input.metaVector,
    });
  }
}

export async function upsertMemorySearchMetaVector(
  ctx: DbCtx,
  input: {
    namespace: string;
    memoryKey: string;
    vector: Float32Array;
  },
): Promise<void> {
  const memoryId = ids.memory(input.namespace, input.memoryKey);
  const sourceMapId = ids.sourceMap(memoryId, MEMORY_SEARCH_META_SOURCE_KEY);
  const sm = await ctxQueryOne<{ _id: string }>(ctx, `SELECT _id FROM source_maps WHERE _id = ?`, [
    sourceMapId,
  ]);
  if (!sm) return;

  await ctxExec(ctx, `DELETE FROM vector_features WHERE source_map_id = ?`, [sourceMapId]);

  await insertVectorFeature(ctx, {
    memoryId,
    sourceMapId,
    vector: input.vector,
  });
}
