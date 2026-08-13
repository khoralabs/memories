import type { ContentBlobColdStore } from "../persistence/content-blob-cold-store";

export type ContentAtRootHit = {
  namespace: string;
  memoryKey: string;
  sourceKey: string;
  text: string;
};

/** LWW rows before resolving cold bodies. */
export type LwwArmRow = {
  namespace: string;
  memoryKey: string;
  sourceKey: string;
  contentSha256: string | null;
  blobText: string | null;
  location: string | null;
  coldUri: string | null;
};

export type LwwScope = { namespace: string; memoryKey: string } | null;

const LWW_SQL = `
  WITH target AS (
    SELECT rowid AS target_rowid FROM memory_provenance WHERE root_hex = ?
  ),
  eligible AS (
    SELECT p.root_hex, p.rowid AS prov_rowid
    FROM memory_provenance p, target
    WHERE p.rowid <= target.target_rowid
  ),
  last_delete AS (
    SELECT o.namespace, o.memory_key, MAX(e.prov_rowid) AS del_rowid
    FROM memory_content_outbox o
    JOIN eligible e ON e.root_hex = o.root_hex
    WHERE o.event_type = 'DELETE_MEMORY'
    {{WHERE}}
    GROUP BY o.namespace, o.memory_key
  ),
  last_merge AS (
    SELECT o.namespace, o.memory_key, o.source_key, MAX(e.prov_rowid) AS merge_rowid
    FROM memory_content_outbox o
    JOIN eligible e ON e.root_hex = o.root_hex
    WHERE o.event_type = 'MERGE_MEMORY'
      AND o.source_key IS NOT NULL
    {{WHERE}}
    GROUP BY o.namespace, o.memory_key, o.source_key
  ),
  picked AS (
    SELECT
      lm.namespace,
      lm.memory_key,
      lm.source_key,
      o.content_sha256
    FROM last_merge lm
    JOIN eligible e ON e.prov_rowid = lm.merge_rowid
    JOIN memory_content_outbox o
      ON o.root_hex = e.root_hex
     AND o.namespace = lm.namespace
     AND o.memory_key = lm.memory_key
     AND o.source_key = lm.source_key
     AND o.event_type = 'MERGE_MEMORY'
    WHERE NOT EXISTS (
      SELECT 1 FROM last_delete ld
      WHERE ld.namespace = lm.namespace
        AND ld.memory_key = lm.memory_key
        AND ld.del_rowid > lm.merge_rowid
    )
  )
  SELECT
    p.namespace AS namespace,
    p.memory_key AS memoryKey,
    p.source_key AS sourceKey,
    p.content_sha256 AS contentSha256,
    b.text AS blobText,
    b.location AS location,
    b.cold_uri AS coldUri
  FROM picked p
  LEFT JOIN memory_content_blobs b ON b.content_sha256 = p.content_sha256
`;

/** Build LWW arms SELECT + bind params (rootHex, then scope×2 when scoped). */
export function buildLwwArmsQuery(
  rootHex: string,
  scope: LwwScope,
): { sql: string; params: unknown[] } {
  const where = scope !== null ? "AND o.namespace = ? AND o.memory_key = ?" : "";
  const sql = LWW_SQL.replaceAll("{{WHERE}}", where);
  if (scope !== null) {
    return {
      sql,
      params: [rootHex, scope.namespace, scope.memoryKey, scope.namespace, scope.memoryKey],
    };
  }
  return { sql, params: [rootHex] };
}

export function hitsFromHot(rows: readonly LwwArmRow[]): ContentAtRootHit[] {
  const out: ContentAtRootHit[] = [];
  for (const row of rows) {
    if (row.blobText == null) continue;
    out.push({
      namespace: row.namespace,
      memoryKey: row.memoryKey,
      sourceKey: row.sourceKey,
      text: row.blobText,
    });
  }
  return out;
}

export const SQL_SELECT_BLOB_BY_SHA = `SELECT location, text FROM memory_content_blobs WHERE content_sha256 = ?`;

export const SQL_INSERT_HOT_BLOB = `INSERT INTO memory_content_blobs (content_sha256, text, location, cold_uri, _ts_created)
       VALUES (?, ?, 'hot', NULL, ?)`;

export const SQL_REHYDRATE_HOT_BLOB = `UPDATE memory_content_blobs SET text = ?, location = 'hot', cold_uri = NULL WHERE content_sha256 = ?`;

export const SQL_INSERT_CONTENT_OUTBOX = `INSERT OR IGNORE INTO memory_content_outbox
         (_id, _ts_created, root_hex, event_type, namespace, memory_key, source_key, text, content_sha256)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

export const SQL_HOT_PROVENANCE_TIPS = `SELECT root_hex FROM memory_provenance
       ORDER BY _ts_created DESC, rowid DESC
       LIMIT ?`;

export function sqlEvacuateCandidates(hotTipCount: number): string {
  const placeholders = Array.from({ length: hotTipCount }, () => "?").join(",");
  return `SELECT DISTINCT b.content_sha256, b.text
       FROM memory_content_blobs b
       WHERE b.location = 'hot'
         AND b.text IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM memory_content_outbox o
           WHERE o.content_sha256 = b.content_sha256
             AND o.root_hex IN (${placeholders})
         )`;
}

export const SQL_EVACUATE_TO_COLD = `UPDATE memory_content_blobs SET text = NULL, location = 'cold', cold_uri = ? WHERE content_sha256 = ?`;

export const SQL_EVACUATE_TO_DROPPED = `UPDATE memory_content_blobs SET text = NULL, location = 'dropped', cold_uri = NULL WHERE content_sha256 = ?`;

export type ContentOutboxSqlDeps = {
  queryAll<T extends Record<string, unknown>>(sql: string, params: unknown[]): Promise<T[]>;
  exec(sql: string, params: unknown[]): Promise<void>;
  coldStore?: ContentBlobColdStore;
  isClosedDatabaseError?(err: unknown): boolean;
};

export type EvacuateContentBlobsOpts = {
  retentionTips?: number;
  coldStore?: ContentBlobColdStore;
  allowDropWithoutColdStore?: boolean;
};
