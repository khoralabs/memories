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
} from "../../../../persistence/core/tip-outbox/legacy-content";
import {
  SQL_INSERT_TIP_BLOB_HOT,
  SQL_INSERT_TIP_OUTBOX,
  SQL_SELECT_TIP_BLOB,
  SQL_UPSERT_TIP_BLOB_REHYDRATE,
} from "../../../../persistence/core/tip-outbox/replay-sql";
import type { TipOutboxLwwRow } from "../../../../persistence/core/tip-outbox/types";
import { execSql } from "../client";
import type { DbCtx } from "../context";
import type { LibsqlDatabase } from "../db";
import { ctxExec, ctxQueryOne, readQueryAll } from "../db";

export type { ContentAtRootHit };

/**
 * Append-only thin content outbox for point-in-time text reconstruction.
 *
 * Rows store `payload_sha256` pointers in `memory_tip_outbox` (`facet='content'`).
 * Bodies live in `memory_tip_blobs` (hot) and optionally a cold store.
 */
export async function appendMergeOutboxEntries(
  ctx: DbCtx,
  input: {
    root_hex: string;
    namespace: string;
    memoryKey: string;
    entries: ReadonlyArray<{ sourceKey: string; text?: string }>;
  },
): Promise<void> {
  for (const appendInput of mergeEntriesToAppendInputs(input, ctx.now)) {
    const { outboxParams, hotBlob } = unifiedContentOutboxInsertParams(appendInput);
    if (hotBlob) await upsertHotTipBlob(ctx, hotBlob.sha256, hotBlob.payload);
    await ctxExec(ctx, SQL_INSERT_TIP_OUTBOX, outboxParams);
  }
}

export async function appendDeleteOutboxEntry(
  ctx: DbCtx,
  input: { root_hex: string; namespace: string; memoryKey: string },
): Promise<void> {
  const { outboxParams } = unifiedContentOutboxInsertParams(
    deleteEntryToAppendInput(input, ctx.now),
  );
  await ctxExec(ctx, SQL_INSERT_TIP_OUTBOX, outboxParams);
}

async function upsertHotTipBlob(
  ctx: DbCtx,
  contentSha256: string,
  payload: Uint8Array,
): Promise<void> {
  const existing = await ctxQueryOne<{ location: string; payload: Uint8Array | null }>(
    ctx,
    SQL_SELECT_TIP_BLOB,
    [contentSha256],
  );
  if (existing === undefined) {
    await ctxExec(ctx, SQL_INSERT_TIP_BLOB_HOT, [contentSha256, payload, ctx.now]);
    return;
  }
  if (existing.location !== "hot" || existing.payload == null) {
    await ctxExec(ctx, SQL_UPSERT_TIP_BLOB_REHYDRATE, [payload, contentSha256]);
  }
}

async function queryLwwArms(
  db: LibsqlDatabase,
  rootHex: string,
  scope: { namespace: string; memoryKey: string } | null,
): Promise<LwwArmRow[]> {
  const { sql, params } = buildContentLwwQuery(rootHex, scope);
  const rows = await readQueryAll<TipOutboxLwwRow>(db, sql, params);
  return rows.map(tipOutboxRowToLwwArm);
}

function libsqlOutboxDeps(db: LibsqlDatabase, coldStore?: ContentBlobColdStore) {
  return {
    queryAll: async <T extends Record<string, unknown>>(
      sql: string,
      params: unknown[],
    ): Promise<T[]> => readQueryAll<T>(db, sql, params),
    exec: async (sql: string, params: unknown[]): Promise<void> => {
      await execSql(db.client, sql, params);
    },
    coldStore,
    isClosedDatabaseError,
  };
}

/** Reconstruct text as of a tip (hot blob). Cold bodies need coldStore. */
export async function getMemoryContentAtRootHex(
  db: LibsqlDatabase,
  rootHex: string,
  namespace: string,
  memoryKey: string,
  coldStore?: ContentBlobColdStore,
): Promise<ContentAtRootHit[]> {
  const rows = await queryLwwArms(db, rootHex, { namespace, memoryKey });
  if (coldStore === undefined) return hitsFromHot(rows);
  return resolveLwwRows(libsqlOutboxDeps(db, coldStore), rows);
}

export async function reconstructStoreAtRootHex(
  db: LibsqlDatabase,
  rootHex: string,
  coldStore?: ContentBlobColdStore,
): Promise<ContentAtRootHit[]> {
  const rows = await queryLwwArms(db, rootHex, null);
  if (coldStore === undefined) return hitsFromHot(rows);
  return resolveLwwRows(libsqlOutboxDeps(db, coldStore), rows);
}

/**
 * Evict blob bodies for tips outside the hot window: upload to cold store if
 * configured; optionally drop when no cold store (`allowDropWithoutColdStore`).
 * Thin outbox rows are never deleted.
 */
export async function evacuateContentBlobsOutsideHotWindow(
  db: LibsqlDatabase,
  opts?: {
    retentionTips?: number;
    coldStore?: ContentBlobColdStore;
    allowDropWithoutColdStore?: boolean;
  },
): Promise<void> {
  await evacuateContentBlobsOutsideHotWindowWith(libsqlOutboxDeps(db, opts?.coldStore), opts);
}

function isClosedDatabaseError(err: unknown): boolean {
  return (
    err instanceof Error &&
    /closed database|database has been closed|cannot use a closed database|connection.*(closed|reset)|CLIENT_CLOSED|HsDisconnected/i.test(
      err.message,
    )
  );
}
