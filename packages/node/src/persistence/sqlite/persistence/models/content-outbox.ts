import type { Database } from "bun:sqlite";
import { sha256Hex } from "../../../../persistence/core/models/sha256";
import type { ContentBlobColdStore } from "../../../../persistence/core/persistence/content-blob-cold-store";
import { DEFAULT_CONTENT_OUTBOX_RETENTION_TIPS } from "../../../../persistence/core/persistence/content-blob-cold-store";
import type { DbCtx } from "./context";

export type ContentAtRootHit = {
  namespace: string;
  memoryKey: string;
  sourceKey: string;
  text: string;
};

/**
 * Append-only thin content outbox for point-in-time text reconstruction.
 *
 * Rows store `content_sha256` pointers (not inline text). Bodies live in
 * `memory_content_blobs` (hot) and optionally a cold store. This design keeps
 * **all thin outbox rows** in the primary DB indefinitely. At extreme tip
 * counts, scale further by **tiered thinning of the outbox itself** (segment
 * old tip ranges into cold parquet/JSONL + a small SQLite catalog)—blob
 * tiering is implemented; outbox segment thinning is intentionally not.
 */
export function appendMergeOutboxEntries(
  ctx: DbCtx,
  input: {
    root_hex: string;
    namespace: string;
    memoryKey: string;
    entries: ReadonlyArray<{ sourceKey: string; text?: string }>;
  },
): void {
  const { now, stmts, db } = ctx;
  for (const entry of input.entries) {
    let contentSha: string | null = null;
    if (entry.text !== undefined) {
      contentSha = sha256Hex(entry.text);
      upsertHotBlob(db, contentSha, entry.text, now);
    }
    stmts.insertContentOutbox.run(
      `${input.root_hex}:${entry.sourceKey}`,
      now,
      input.root_hex,
      "MERGE_MEMORY",
      input.namespace,
      input.memoryKey,
      entry.sourceKey,
      null,
      contentSha,
    );
  }
}

export function appendDeleteOutboxEntry(
  ctx: DbCtx,
  input: { root_hex: string; namespace: string; memoryKey: string },
): void {
  const { now, stmts } = ctx;
  stmts.insertContentOutbox.run(
    `${input.root_hex}:__delete__`,
    now,
    input.root_hex,
    "DELETE_MEMORY",
    input.namespace,
    input.memoryKey,
    null,
    null,
    null,
  );
}

function upsertHotBlob(db: Database, contentSha256: string, text: string, now: number): void {
  const existing = db
    .query<{ location: string; text: string | null }, [string]>(
      `SELECT location, text FROM memory_content_blobs WHERE content_sha256 = ?`,
    )
    .get(contentSha256);
  if (existing === null || existing === undefined) {
    db.run(
      `INSERT INTO memory_content_blobs (content_sha256, text, location, cold_uri, _ts_created)
       VALUES (?, ?, 'hot', NULL, ?)`,
      [contentSha256, text, now],
    );
    return;
  }
  if (existing.location !== "hot" || existing.text == null) {
    db.run(
      `UPDATE memory_content_blobs SET text = ?, location = 'hot', cold_uri = NULL WHERE content_sha256 = ?`,
      [text, contentSha256],
    );
  }
}

/** LWW rows before resolving cold bodies. */
type LwwArmRow = {
  namespace: string;
  memoryKey: string;
  sourceKey: string;
  contentSha256: string | null;
  legacyText: string | null;
  blobText: string | null;
  location: string | null;
  coldUri: string | null;
};

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
      o.content_sha256,
      o.text AS legacy_text
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
    p.legacy_text AS legacyText,
    b.text AS blobText,
    b.location AS location,
    b.cold_uri AS coldUri
  FROM picked p
  LEFT JOIN memory_content_blobs b ON b.content_sha256 = p.content_sha256
`;

function queryLwwArms(
  db: Database,
  rootHex: string,
  scope: { namespace: string; memoryKey: string } | null,
): LwwArmRow[] {
  const where = scope !== null ? "AND o.namespace = ? AND o.memory_key = ?" : "";
  const sql = LWW_SQL.replaceAll("{{WHERE}}", where);
  if (scope !== null) {
    return db
      .query<LwwArmRow, [string, string, string, string, string]>(sql)
      .all(rootHex, scope.namespace, scope.memoryKey, scope.namespace, scope.memoryKey);
  }
  return db.query<LwwArmRow, [string]>(sql).all(rootHex);
}

function hitsFromHotOrLegacy(rows: LwwArmRow[]): ContentAtRootHit[] {
  const out: ContentAtRootHit[] = [];
  for (const row of rows) {
    const text = row.blobText ?? row.legacyText;
    if (text == null) continue;
    out.push({
      namespace: row.namespace,
      memoryKey: row.memoryKey,
      sourceKey: row.sourceKey,
      text,
    });
  }
  return out;
}

/**
 * Reconstruct text content of one memory as of a provenance tip (hot + legacy only).
 * Cold bodies require {@link getMemoryContentAtRootHexAsync}.
 */
export function getMemoryContentAtRootHex(
  db: Database,
  rootHex: string,
  namespace: string,
  memoryKey: string,
): ContentAtRootHit[] {
  return hitsFromHotOrLegacy(queryLwwArms(db, rootHex, { namespace, memoryKey }));
}

export function reconstructStoreAtRootHex(db: Database, rootHex: string): ContentAtRootHit[] {
  return hitsFromHotOrLegacy(queryLwwArms(db, rootHex, null));
}

/**
 * Full LWW reconstruct including cold-store fetch + optional hot rehydrate.
 */
export async function getMemoryContentAtRootHexAsync(
  db: Database,
  rootHex: string,
  namespace: string,
  memoryKey: string,
  coldStore?: ContentBlobColdStore,
): Promise<ContentAtRootHit[]> {
  const rows = queryLwwArms(db, rootHex, { namespace, memoryKey });
  return resolveLwwRows(db, rows, coldStore);
}

export async function reconstructStoreAtRootHexAsync(
  db: Database,
  rootHex: string,
  coldStore?: ContentBlobColdStore,
): Promise<ContentAtRootHit[]> {
  const rows = queryLwwArms(db, rootHex, null);
  return resolveLwwRows(db, rows, coldStore);
}

async function resolveLwwRows(
  db: Database,
  rows: LwwArmRow[],
  coldStore?: ContentBlobColdStore,
): Promise<ContentAtRootHit[]> {
  const out: ContentAtRootHit[] = [];
  for (const row of rows) {
    let text = row.blobText ?? row.legacyText;
    if (
      (text == null || text.length === 0) &&
      row.location === "cold" &&
      row.contentSha256 &&
      coldStore
    ) {
      const fetched = await coldStore.get(row.contentSha256);
      if (fetched !== null && sha256Hex(fetched) === row.contentSha256) {
        text = fetched;
        db.run(
          `UPDATE memory_content_blobs SET text = ?, location = 'hot', cold_uri = NULL WHERE content_sha256 = ?`,
          [fetched, row.contentSha256],
        );
      }
    }
    if (text == null) continue;
    if (row.location === "dropped" && row.blobText == null && row.legacyText == null) continue;
    out.push({
      namespace: row.namespace,
      memoryKey: row.memoryKey,
      sourceKey: row.sourceKey,
      text,
    });
  }
  return out;
}

/**
 * Evict blob bodies for tips outside the hot window: upload to cold store if
 * configured, otherwise permanently drop. Thin outbox rows are never deleted.
 */
export async function evacuateContentBlobsOutsideHotWindow(
  db: Database,
  opts?: {
    retentionTips?: number;
    coldStore?: ContentBlobColdStore;
  },
): Promise<void> {
  try {
    await evacuateContentBlobsOutsideHotWindowInner(db, opts);
  } catch (err) {
    // Callers may close the DB before a deferred cold-store continuation finishes.
    if (isClosedDatabaseError(err)) return;
    throw err;
  }
}

function isClosedDatabaseError(err: unknown): boolean {
  return (
    err instanceof Error &&
    /closed database|database has been closed|cannot use a closed database/i.test(err.message)
  );
}

async function evacuateContentBlobsOutsideHotWindowInner(
  db: Database,
  opts?: {
    retentionTips?: number;
    coldStore?: ContentBlobColdStore;
  },
): Promise<void> {
  const retention = opts?.retentionTips ?? DEFAULT_CONTENT_OUTBOX_RETENTION_TIPS;
  if (retention === 0) return;

  const hotTips = db
    .query<{ root_hex: string }, [number]>(
      `SELECT root_hex FROM memory_provenance
       ORDER BY _ts_created DESC, rowid DESC
       LIMIT ?`,
    )
    .all(retention)
    .map((r) => r.root_hex);
  if (hotTips.length === 0) return;

  const placeholders = hotTips.map(() => "?").join(",");
  const candidates = db
    .query<{ content_sha256: string; text: string | null }, string[]>(
      `SELECT DISTINCT b.content_sha256, b.text
       FROM memory_content_blobs b
       WHERE b.location = 'hot'
         AND b.text IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM memory_content_outbox o
           WHERE o.content_sha256 = b.content_sha256
             AND o.root_hex IN (${placeholders})
         )`,
    )
    .all(...hotTips);

  const coldStore = opts?.coldStore;
  for (const row of candidates) {
    if (row.text == null) continue;
    if (coldStore !== undefined) {
      await coldStore.put(row.content_sha256, row.text);
      const uri = coldStore.uriFor(row.content_sha256);
      db.run(
        `UPDATE memory_content_blobs SET text = NULL, location = 'cold', cold_uri = ? WHERE content_sha256 = ?`,
        [uri, row.content_sha256],
      );
    } else {
      db.run(
        `UPDATE memory_content_blobs SET text = NULL, location = 'dropped', cold_uri = NULL WHERE content_sha256 = ?`,
        [row.content_sha256],
      );
    }
  }
}
