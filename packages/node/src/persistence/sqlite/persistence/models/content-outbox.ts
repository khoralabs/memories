import type { Database } from "bun:sqlite";
import {
  evacuateContentBlobsOutsideHotWindowWith,
  resolveLwwRows,
} from "../../../../persistence/core/models/content-outbox-lww";
import {
  type ContentAtRootHit,
  hitsFromHot,
  type LwwArmRow,
} from "../../../../persistence/core/models/content-outbox-sql";
import type { ContentBlobColdStore } from "../../../../persistence/core/persistence/content-blob-cold-store";
import {
  buildContentLwwQuery,
  deleteEntryToAppendInput,
  mergeEntriesToAppendInputs,
  tipOutboxRowToLwwArm,
  unifiedContentOutboxInsertParams,
} from "../../../../persistence/core/tip-outbox/content-facet";
import {
  SQL_INSERT_TIP_BLOB_HOT,
  SQL_INSERT_TIP_OUTBOX,
  SQL_SELECT_TIP_BLOB,
  SQL_UPSERT_TIP_BLOB_REHYDRATE,
} from "../../../../persistence/core/tip-outbox/replay-sql";
import type { TipOutboxLwwRow } from "../../../../persistence/core/tip-outbox/types";
import type { DbCtx } from "./context";

export type { ContentAtRootHit };

/**
 * Append-only thin content outbox for point-in-time text reconstruction.
 *
 * Rows store `payload_sha256` pointers in `memory_tip_outbox` (`facet='content'`).
 * Bodies live in `memory_tip_blobs` (hot) and optionally a cold store.
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
  const { now, db } = ctx;
  for (const appendInput of mergeEntriesToAppendInputs(input, now)) {
    const { outboxParams, hotBlob } = unifiedContentOutboxInsertParams(appendInput);
    if (hotBlob) upsertHotTipBlob(db, hotBlob.sha256, hotBlob.payload, now);
    db.run(SQL_INSERT_TIP_OUTBOX, outboxParams as never[]);
  }
}

export function appendDeleteOutboxEntry(
  ctx: DbCtx,
  input: { root_hex: string; namespace: string; memoryKey: string },
): void {
  const { now, db } = ctx;
  const { outboxParams } = unifiedContentOutboxInsertParams(deleteEntryToAppendInput(input, now));
  db.run(SQL_INSERT_TIP_OUTBOX, outboxParams as never[]);
}

function upsertHotTipBlob(
  db: Database,
  contentSha256: string,
  payload: Uint8Array,
  now: number,
): void {
  const existing = db
    .query<{ location: string; payload: Uint8Array | null }, [string]>(SQL_SELECT_TIP_BLOB)
    .get(contentSha256);
  if (existing === null || existing === undefined) {
    db.run(SQL_INSERT_TIP_BLOB_HOT, [contentSha256, payload, now]);
    return;
  }
  if (existing.location !== "hot" || existing.payload == null) {
    db.run(SQL_UPSERT_TIP_BLOB_REHYDRATE, [payload, contentSha256]);
  }
}

function queryLwwArms(
  db: Database,
  rootHex: string,
  scope: { namespace: string; memoryKey: string } | null,
): LwwArmRow[] {
  const { sql, params } = buildContentLwwQuery(rootHex, scope);
  const rows = db.query(sql).all(...(params as never[])) as TipOutboxLwwRow[];
  return rows.map(tipOutboxRowToLwwArm);
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
