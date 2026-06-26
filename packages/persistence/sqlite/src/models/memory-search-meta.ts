import {
  isSystemSearchMetaSourceKey,
  MEMORY_SEARCH_META_SOURCE_KEY,
} from "@khoralabs/memories-core/search-meta-constants";
import { ids } from "@khoralabs/memories-persistence-core";
import { blobToVector } from "../connection";
import type { DbCtx } from "./context";
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

/**
 * Neighboring memories linked by an edge to this node (any namespace), for invalidation sets.
 */
export function listNeighborMemoriesForNode(
  ctx: DbCtx,
  _namespace: string,
  nodeId: string,
): Array<{ namespace: string; key: string }> {
  const rows = ctx.db
    .query<{ namespace: string; key: string }, [string, string, string]>(
      `SELECT DISTINCT m.namespace AS namespace, m.key AS key
       FROM edges e
       JOIN nodes n_other ON n_other._id = CASE
         WHEN e.from_node_id = ? THEN e.to_node_id
         ELSE e.from_node_id
       END
       JOIN memories m ON m._id = n_other.memory_id
       WHERE e.from_node_id = ? OR e.to_node_id = ?`,
    )
    .all(nodeId, nodeId, nodeId);
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

/** Incident edges for search-meta and label-props sync (cross-namespace supported). */
export function collectEdgesFromDb(
  ctx: DbCtx,
  nodeId: string,
  _namespace: string,
): Array<{
  edgeId: string;
  neighborKey: string;
  direction: "in" | "out";
  labelsJoined: string | null;
}> {
  return ctx.db
    .query<
      { edgeId: string; neighborKey: string; direction: string; labelsJoined: string | null },
      [string, string, string, string, string]
    >(
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
    )
    .all(nodeId, nodeId, nodeId, nodeId, nodeId)
    .map((r) => ({
      edgeId: r.edgeId,
      neighborKey: r.neighborKey,
      direction: r.direction === "out" ? ("out" as const) : ("in" as const),
      labelsJoined: r.labelsJoined,
    }));
}

function collectNodeLabelsFromDb(ctx: DbCtx, nodeId: string): string[] {
  const rows = ctx.db
    .query<{ label: string }, [string]>(
      `SELECT nl.kind AS label
       FROM node_label_assignments nla
       JOIN node_labels nl ON nl._id = nla.label_id
       WHERE nla.node_id = ?
       ORDER BY nl.kind ASC`,
    )
    .all(nodeId);
  return rows.map((r) => r.label);
}

/** Canonical multiline text derived from graph tables (node labels + incident edges). */
export function buildCanonicalMemorySearchMetaText(
  ctx: DbCtx,
  namespace: string,
  memoryKey: string,
): string {
  const memoryId = ids.memory(namespace, memoryKey);
  const mk = ctx.db
    .query<{ kind: string | null; edge_id: string | null }, [string]>(
      `SELECT kind, edge_id FROM memories WHERE _id = ?`,
    )
    .get(memoryId);
  const kind = mk?.kind ?? "node";
  if (kind === "edge" && mk?.edge_id) {
    const link = loadGraphEdge(ctx.db, namespace, mk.edge_id);
    if (!link) return "";
    const edgeKinds = link.labels.map((l) => l.kind).sort((a, b) => a.localeCompare(b));
    return `edge_memory:${link.fromKey}<->${link.toKey}:${edgeKinds.join("|")}`;
  }
  const nodeId = ids.node(namespace, memoryKey);
  const labels = collectNodeLabelsFromDb(ctx, nodeId);
  const nodeLines = formatNodeLines(labels);
  const edgeRows = collectEdgesFromDb(ctx, nodeId, namespace);
  const edgeLines = edgeRows.map((r) =>
    formatEdgeLine(r.direction, r.neighborKey, parseEdgeLabelsJoined(r.labelsJoined)),
  );
  const lines = [...nodeLines, ...edgeLines].sort((a, b) => a.localeCompare(b));
  return lines.join("\n");
}

function deleteVectorRowAndVecIndex(
  ctx: DbCtx,
  vectorFeatureId: string,
  vectorBlob: Buffer | Uint8Array,
) {
  const floats = blobToVector(
    vectorBlob instanceof Buffer ? new Uint8Array(vectorBlob) : vectorBlob,
  );
  const dim = floats.length;
  if (dim < 512 || dim > 3072) return;
  ctx.stmts.getDeleteVectorVecByFeatureId(dim).run(vectorFeatureId);
  ctx.stmts.deleteVectorFeaturesByFeatureId.run(vectorFeatureId);
}

/** Remove synthetic search-meta chunk for a memory if present. */
export function removeMemorySearchMeta(ctx: DbCtx, memoryId: string): void {
  const { db, stmts } = ctx;
  const sourceMapId = ids.sourceMap(memoryId, MEMORY_SEARCH_META_SOURCE_KEY);
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

/**
 * Rebuild lexical (+ optional vector) search meta from current graph state.
 * @param metaVector - only pass for the primary merged memory when the host pre-embedded {@link buildCanonicalMemorySearchMetaTextForMerge} / DB-equivalent text.
 */
export function syncMemorySearchMeta(
  ctx: DbCtx,
  input: {
    namespace: string;
    memoryKey: string;
    metaVector?: Float32Array;
  },
): void {
  const memoryId = ids.memory(input.namespace, input.memoryKey);
  const text = buildCanonicalMemorySearchMetaText(ctx, input.namespace, input.memoryKey);
  removeMemorySearchMeta(ctx, memoryId);
  if (text.length === 0) return;

  const { sourceMapId } = insertSourceMap(ctx, {
    memoryId,
    sourceKey: MEMORY_SEARCH_META_SOURCE_KEY,
  });
  insertLexicalFeature(ctx, { memoryId, sourceMapId, text });
  if (input.metaVector !== undefined && input.metaVector.length > 0) {
    insertVectorFeature(ctx, {
      memoryId,
      sourceMapId,
      vector: input.metaVector,
    });
  }
}

/**
 * Replace vec0 + `vector_features` rows for the search-meta `source_map` only (lexical/meta must exist).
 * Use after {@link syncMemorySearchMeta} when embeddings are produced out-of-band (e.g. batch for all graph-touched memories).
 */
export function upsertMemorySearchMetaVector(
  ctx: DbCtx,
  input: {
    namespace: string;
    memoryKey: string;
    vector: Float32Array;
  },
): void {
  const memoryId = ids.memory(input.namespace, input.memoryKey);
  const sourceMapId = ids.sourceMap(memoryId, MEMORY_SEARCH_META_SOURCE_KEY);
  const sm = ctx.db
    .query<{ _id: string }, [string]>(`SELECT _id FROM source_maps WHERE _id = ?`)
    .get(sourceMapId);
  if (!sm) return;

  const vfRows = ctx.db
    .query<{ _id: string; vector: Buffer | Uint8Array }, [string]>(
      `SELECT _id, vector FROM vector_features WHERE source_map_id = ?`,
    )
    .all(sourceMapId);
  for (const row of vfRows) {
    deleteVectorRowAndVecIndex(ctx, row._id, row.vector);
  }

  insertVectorFeature(ctx, {
    memoryId,
    sourceMapId,
    vector: input.vector,
  });
}
