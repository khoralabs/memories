import type { Database } from "bun:sqlite";
import {
  evacuateContentBlobsOutsideHotWindowWith,
  resolveLwwRows,
} from "../../../../persistence/core/models/content-outbox-lww";
import {
  buildLwwArmsQuery,
  type ContentAtRootHit,
  hitsFromHot,
  type LwwArmRow,
  SQL_INSERT_HOT_BLOB,
  SQL_REHYDRATE_HOT_BLOB,
  SQL_SELECT_BLOB_BY_SHA,
} from "../../../../persistence/core/models/content-outbox-sql";
import { sha256Hex } from "../../../../persistence/core/models/sha256";
import type { ContentBlobColdStore } from "../../../../persistence/core/persistence/content-blob-cold-store";
import type { DbCtx } from "./context";

export type { ContentAtRootHit };

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
    .query<{ location: string; text: string | null }, [string]>(SQL_SELECT_BLOB_BY_SHA)
    .get(contentSha256);
  if (existing === null || existing === undefined) {
    db.run(SQL_INSERT_HOT_BLOB, [contentSha256, text, now]);
    return;
  }
  if (existing.location !== "hot" || existing.text == null) {
    db.run(SQL_REHYDRATE_HOT_BLOB, [text, contentSha256]);
  }
}

function queryLwwArms(
  db: Database,
  rootHex: string,
  scope: { namespace: string; memoryKey: string } | null,
): LwwArmRow[] {
  const { sql, params } = buildLwwArmsQuery(rootHex, scope);
  // bun:sqlite bindings are positional scalars
  return db.query(sql).all(...(params as never[])) as LwwArmRow[];
}

function sqliteOutboxDeps(db: Database, coldStore?: ContentBlobColdStore) {
  return {
    queryAll: async <T extends Record<string, unknown>>(
      sql: string,
      params: unknown[],
    ): Promise<T[]> => db.query(sql).all(...(params as never[])) as T[],
    exec: async (sql: string, params: unknown[]): Promise<void> => {
      db.run(sql, params as never[]);
    },
    coldStore,
    isClosedDatabaseError,
  };
}

/**
 * Reconstruct text content of one memory as of a provenance tip (hot blob only).
 * Cold bodies require {@link getMemoryContentAtRootHexAsync}.
 */
export function getMemoryContentAtRootHex(
  db: Database,
  rootHex: string,
  namespace: string,
  memoryKey: string,
): ContentAtRootHit[] {
  return hitsFromHot(queryLwwArms(db, rootHex, { namespace, memoryKey }));
}

export function reconstructStoreAtRootHex(db: Database, rootHex: string): ContentAtRootHit[] {
  return hitsFromHot(queryLwwArms(db, rootHex, null));
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
  return resolveLwwRows(sqliteOutboxDeps(db, coldStore), rows);
}

export async function reconstructStoreAtRootHexAsync(
  db: Database,
  rootHex: string,
  coldStore?: ContentBlobColdStore,
): Promise<ContentAtRootHit[]> {
  const rows = queryLwwArms(db, rootHex, null);
  return resolveLwwRows(sqliteOutboxDeps(db, coldStore), rows);
}

/**
 * Evict blob bodies for tips outside the hot window: upload to cold store if
 * configured; optionally drop when no cold store (`allowDropWithoutColdStore`).
 * Thin outbox rows are never deleted.
 */
export async function evacuateContentBlobsOutsideHotWindow(
  db: Database,
  opts?: {
    retentionTips?: number;
    coldStore?: ContentBlobColdStore;
    allowDropWithoutColdStore?: boolean;
  },
): Promise<void> {
  await evacuateContentBlobsOutsideHotWindowWith(sqliteOutboxDeps(db, opts?.coldStore), opts);
}

function isClosedDatabaseError(err: unknown): boolean {
  return (
    err instanceof Error &&
    /closed database|database has been closed|cannot use a closed database/i.test(err.message)
  );
}
