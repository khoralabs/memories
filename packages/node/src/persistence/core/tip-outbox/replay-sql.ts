import { TIP_OUTBOX_FACET_CONFIG } from "./facets";
import type { TipOutboxFacet, TipOutboxReplayScope, TipOutboxTableNames } from "./types";

function facetFilter(table: TipOutboxTableNames, facet: TipOutboxFacet): string {
  return table.hasFacetColumn ? ` AND o.facet = '${facet}'` : "";
}

function scopeWhere(
  scope: TipOutboxReplayScope,
  opts?: { includeEdgeId?: boolean },
): { sql: string; extraParams: unknown[] } {
  const parts: string[] = [];
  const params: unknown[] = [];
  if (scope.namespace !== undefined) {
    parts.push(" AND o.namespace = ?");
    params.push(scope.namespace);
  }
  if (scope.memoryKey !== undefined) {
    parts.push(" AND o.memory_key = ?");
    params.push(scope.memoryKey);
  }
  if (opts?.includeEdgeId !== false && scope.edgeId !== undefined) {
    parts.push(" AND o.edge_id = ?");
    params.push(scope.edgeId);
  }
  return { sql: parts.join(""), extraParams: params };
}

function mergeEventsSql(facet: TipOutboxFacet): string {
  const types = TIP_OUTBOX_FACET_CONFIG[facet].mergeEventTypes;
  if (types.length === 1) return `o.event_type = '${types[0]}'`;
  return `o.event_type IN (${types.map((t) => `'${t}'`).join(", ")})`;
}

function mergeGroupForFacet(facet: TipOutboxFacet): string {
  switch (facet) {
    case "provenance":
      return "o.root_hex";
    case "graph":
      return "o.namespace, o.memory_key, o.edge_id";
    case "content":
    case "vector":
      return "o.namespace, o.memory_key, o.source_key";
  }
}

function deleteGroupForFacet(facet: TipOutboxFacet): string {
  return facet === "provenance" ? "o.root_hex" : "o.namespace, o.memory_key";
}

function mergeJoinOn(facet: TipOutboxFacet): string {
  switch (facet) {
    case "provenance":
      return "o.root_hex = lm.root_hex";
    case "graph":
      return `o.namespace = lm.namespace
     AND o.memory_key = lm.memory_key
     AND (o.edge_id = lm.edge_id OR (o.edge_id IS NULL AND lm.edge_id IS NULL))`;
    case "content":
    case "vector":
      return `o.namespace = lm.namespace
     AND o.memory_key = lm.memory_key
     AND o.source_key = lm.source_key`;
  }
}

function deleteNotExistsClause(facet: TipOutboxFacet): string {
  if (facet === "provenance") {
    return `NOT EXISTS (
      SELECT 1 FROM last_delete ld
      WHERE ld.root_hex = lm.root_hex
        AND ld.del_rowid > lm.merge_rowid
    )`;
  }
  return `NOT EXISTS (
      SELECT 1 FROM last_delete ld
      WHERE ld.namespace = lm.namespace
        AND ld.memory_key = lm.memory_key
        AND ld.del_rowid > lm.merge_rowid
    )`;
}

/** LWW replay SELECT for unified `memory_tip_outbox` + `memory_tip_blobs`. */
export function buildTipOutboxLwwQuery(
  rootHex: string,
  scope: TipOutboxReplayScope,
  tables: TipOutboxTableNames,
): { sql: string; params: unknown[] } {
  const facet = scope.facet;
  const facetSql = facetFilter(tables, facet);
  const mergeScope = scopeWhere(scope);
  const deleteScope = scopeWhere(scope, { includeEdgeId: false });
  const mergeGroup = mergeGroupForFacet(facet);
  const deleteGroup = deleteGroupForFacet(facet);
  const mergeJoin = mergeJoinOn(facet);
  const deleteClause = deleteNotExistsClause(facet);
  const mergeEvents = mergeEventsSql(facet);

  const isLegacy = !tables.hasFacetColumn;
  const facetSelect = isLegacy ? `'content' AS facet` : "o.facet AS facet";
  const edgeSelect = isLegacy ? "NULL AS edgeId" : "o.edge_id AS edgeId";
  const payloadSelect = isLegacy
    ? "o.content_sha256 AS payloadSha256"
    : "o.payload_sha256 AS payloadSha256";
  const legacyFacetSql = isLegacy ? "" : facetSql;

  const blobTextCol = tables.blobs === "memory_content_blobs" ? "b.text" : "NULL";
  const blobBytesCol = tables.blobs === "memory_tip_blobs" ? "b.payload" : "NULL";

  const sql = `
  WITH target AS (
    SELECT rowid AS target_rowid FROM memory_provenance WHERE root_hex = ?
  ),
  eligible AS (
    SELECT p.root_hex, p.rowid AS prov_rowid
    FROM memory_provenance p, target
    WHERE p.rowid <= target.target_rowid
  ),
  last_delete AS (
    SELECT ${deleteGroup}, MAX(e.prov_rowid) AS del_rowid
    FROM ${tables.outbox} o
    JOIN eligible e ON e.root_hex = o.root_hex
    WHERE o.event_type = 'DELETE_MEMORY'${legacyFacetSql}${deleteScope.sql}
    GROUP BY ${deleteGroup}
  ),
  last_merge AS (
    SELECT ${mergeGroup}, MAX(e.prov_rowid) AS merge_rowid
    FROM ${tables.outbox} o
    JOIN eligible e ON e.root_hex = o.root_hex
    WHERE ${mergeEvents}${mergeSourceKeyClause(facet)}${legacyFacetSql}${mergeScope.sql}
    GROUP BY ${mergeGroup}
  ),
  picked AS (
    SELECT
      ${facetSelect},
      o.namespace AS namespace,
      o.memory_key AS memoryKey,
      o.source_key AS sourceKey,
      ${edgeSelect},
      ${payloadSelect}
    FROM last_merge lm
    JOIN eligible e ON e.prov_rowid = lm.merge_rowid
    JOIN ${tables.outbox} o
      ON o.root_hex = e.root_hex
     AND ${mergeJoin}
     AND ${mergeEvents}${legacyFacetSql}
    WHERE ${deleteClause}
  )
  SELECT
    p.facet,
    p.namespace,
    p.memoryKey,
    p.sourceKey,
    p.edgeId,
    p.payloadSha256,
    ${blobTextCol} AS blobText,
    ${blobBytesCol} AS blobBytes,
    b.location AS location,
    b.cold_uri AS coldUri
  FROM picked p
  LEFT JOIN ${tables.blobs} b ON b.content_sha256 = p.payloadSha256
`;

  const params: unknown[] = [rootHex, ...deleteScope.extraParams, ...mergeScope.extraParams];
  return { sql, params };
}

function mergeSourceKeyClause(facet: TipOutboxFacet): string {
  return facet === "content" || facet === "vector" ? " AND o.source_key IS NOT NULL" : "";
}

export const SQL_INSERT_TIP_OUTBOX = `INSERT OR IGNORE INTO memory_tip_outbox
  (_id, _ts_created, root_hex, facet, event_type, namespace, memory_key, source_key, edge_id, payload_sha256)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

export const SQL_INSERT_TIP_BLOB_HOT = `INSERT INTO memory_tip_blobs (content_sha256, payload, location, cold_uri, _ts_created)
  VALUES (?, ?, 'hot', NULL, ?)`;

export const SQL_UPSERT_TIP_BLOB_REHYDRATE = `UPDATE memory_tip_blobs SET payload = ?, location = 'hot', cold_uri = NULL WHERE content_sha256 = ?`;

export const SQL_SELECT_TIP_BLOB = `SELECT location, payload FROM memory_tip_blobs WHERE content_sha256 = ?`;

export const LEGACY_CONTENT_TABLES: TipOutboxTableNames = {
  outbox: "memory_content_outbox",
  blobs: "memory_content_blobs",
  hasFacetColumn: false,
};

export const UNIFIED_TIP_TABLES: TipOutboxTableNames = {
  outbox: "memory_tip_outbox",
  blobs: "memory_tip_blobs",
  hasFacetColumn: true,
};
