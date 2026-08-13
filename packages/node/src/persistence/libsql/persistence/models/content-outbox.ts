import {
  evacuateContentBlobsOutsideHotWindowWith,
  resolveLwwRows,
} from "../../../../persistence/core/models/content-outbox-lww";
import {
  buildLwwArmsQuery,
  type ContentAtRootHit,
  hitsFromHot,
  type LwwArmRow,
  SQL_INSERT_CONTENT_OUTBOX,
  SQL_INSERT_HOT_BLOB,
  SQL_REHYDRATE_HOT_BLOB,
  SQL_SELECT_BLOB_BY_SHA,
} from "../../../../persistence/core/models/content-outbox-sql";
import { sha256Hex } from "../../../../persistence/core/models/sha256";
import type { ContentBlobColdStore } from "../../../../persistence/core/persistence/content-blob-cold-store";
import { execSql } from "../client";
import type { DbCtx } from "../context";
import type { LibsqlDatabase } from "../db";
import { ctxExec, ctxQueryOne, readQueryAll } from "../db";

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
export async function appendMergeOutboxEntries(
  ctx: DbCtx,
  input: {
    root_hex: string;
    namespace: string;
    memoryKey: string;
    entries: ReadonlyArray<{ sourceKey: string; text?: string }>;
  },
): Promise<void> {
  for (const entry of input.entries) {
    let contentSha: string | null = null;
    if (entry.text !== undefined) {
      contentSha = sha256Hex(entry.text);
      await upsertHotBlob(ctx, contentSha, entry.text);
    }
    await ctxExec(ctx, SQL_INSERT_CONTENT_OUTBOX, [
      `${input.root_hex}:${entry.sourceKey}`,
      ctx.now,
      input.root_hex,
      "MERGE_MEMORY",
      input.namespace,
      input.memoryKey,
      entry.sourceKey,
      null,
      contentSha,
    ]);
  }
}

export async function appendDeleteOutboxEntry(
  ctx: DbCtx,
  input: { root_hex: string; namespace: string; memoryKey: string },
): Promise<void> {
  await ctxExec(ctx, SQL_INSERT_CONTENT_OUTBOX, [
    `${input.root_hex}:__delete__`,
    ctx.now,
    input.root_hex,
    "DELETE_MEMORY",
    input.namespace,
    input.memoryKey,
    null,
    null,
    null,
  ]);
}

async function upsertHotBlob(ctx: DbCtx, contentSha256: string, text: string): Promise<void> {
  const existing = await ctxQueryOne<{ location: string; text: string | null }>(
    ctx,
    SQL_SELECT_BLOB_BY_SHA,
    [contentSha256],
  );
  if (existing === undefined) {
    await ctxExec(ctx, SQL_INSERT_HOT_BLOB, [contentSha256, text, ctx.now]);
    return;
  }
  if (existing.location !== "hot" || existing.text == null) {
    await ctxExec(ctx, SQL_REHYDRATE_HOT_BLOB, [text, contentSha256]);
  }
}

async function queryLwwArms(
  db: LibsqlDatabase,
  rootHex: string,
  scope: { namespace: string; memoryKey: string } | null,
): Promise<LwwArmRow[]> {
  const { sql, params } = buildLwwArmsQuery(rootHex, scope);
  return readQueryAll<LwwArmRow>(db, sql, params);
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
