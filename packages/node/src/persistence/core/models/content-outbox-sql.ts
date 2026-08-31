import type { ContentBlobColdStore } from "../persistence/content-blob-cold-store";
import { buildContentLwwQuery } from "../tip-outbox/content-facet";

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

/** Build LWW arms SELECT + bind params (rootHex, then scope×2 when scoped). */
export function buildLwwArmsQuery(
  rootHex: string,
  scope: LwwScope,
): { sql: string; params: unknown[] } {
  return buildContentLwwQuery(rootHex, scope);
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

export const SQL_HOT_PROVENANCE_TIPS = `SELECT root_hex FROM memory_provenance
       ORDER BY _ts_created DESC, rowid DESC
       LIMIT ?`;

export function sqlEvacuateCandidates(hotTipCount: number): string {
  const placeholders = Array.from({ length: hotTipCount }, () => "?").join(",");
  return `SELECT DISTINCT b.content_sha256, b.payload
       FROM memory_tip_blobs b
       WHERE b.location = 'hot'
         AND b.payload IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM memory_tip_outbox o
           WHERE o.facet = 'content'
             AND o.payload_sha256 = b.content_sha256
             AND o.root_hex IN (${placeholders})
         )`;
}

export const SQL_EVACUATE_TO_COLD = `UPDATE memory_tip_blobs SET payload = NULL, location = 'cold', cold_uri = ? WHERE content_sha256 = ?`;

export const SQL_EVACUATE_TO_DROPPED = `UPDATE memory_tip_blobs SET payload = NULL, location = 'dropped', cold_uri = NULL WHERE content_sha256 = ?`;

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
