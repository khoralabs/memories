import {
  evacuateContentBlobsOutsideHotWindowWith,
  resolveLwwRows,
} from "../../../../persistence/core/models/content-outbox-lww";
import {
  type ContentAtRootHit,
  hitsFromHot,
  type LwwArmRow,
  SQL_INSERT_CONTENT_OUTBOX,
} from "../../../../persistence/core/models/content-outbox-sql";
import type { ContentBlobColdStore } from "../../../../persistence/core/persistence/content-blob-cold-store";
import {
  buildLegacyContentLwwQuery,
  deleteEntryToAppendInput,
  legacyContentOutboxInsertParams,
  mergeEntriesToAppendInputs,
  SQL_INSERT_HOT_BLOB,
  SQL_REHYDRATE_HOT_BLOB,
  SQL_SELECT_BLOB_BY_SHA,
  tipOutboxRowToLwwArm,
} from "../../../../persistence/core/tip-outbox";
import type { TipOutboxLwwRow } from "../../../../persistence/core/tip-outbox/types";
import { execSql } from "../client";
import type { DbCtx } from "../context";
import type { TursoDatabase } from "../db";
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
  for (const appendInput of mergeEntriesToAppendInputs(input, ctx.now)) {
    const { outboxParams, hotBlob } = legacyContentOutboxInsertParams(appendInput);
    if (hotBlob) await upsertHotBlob(ctx, hotBlob.sha256, hotBlob.text);
    await ctxExec(ctx, SQL_INSERT_CONTENT_OUTBOX, outboxParams);
  }
}

export async function appendDeleteOutboxEntry(
  ctx: DbCtx,
  input: { root_hex: string; namespace: string; memoryKey: string },
): Promise<void> {
  const { outboxParams } = legacyContentOutboxInsertParams(
    deleteEntryToAppendInput(input, ctx.now),
  );
  await ctxExec(ctx, SQL_INSERT_CONTENT_OUTBOX, outboxParams);
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
  db: TursoDatabase,
  rootHex: string,
  scope: { namespace: string; memoryKey: string } | null,
): Promise<LwwArmRow[]> {
  const { sql, params } = buildLegacyContentLwwQuery(rootHex, scope);
  const rows = await readQueryAll<TipOutboxLwwRow>(db, sql, params);
  return rows.map(tipOutboxRowToLwwArm);
}

function tursoOutboxDeps(db: TursoDatabase, coldStore?: ContentBlobColdStore) {
  return {
    queryAll: async <T extends Record<string, unknown>>(
      sql: string,
      params: unknown[],
    ): Promise<T[]> => readQueryAll<T>(db, sql, params),
    exec: async (sql: string, params: unknown[]): Promise<void> => {
      await execSql(db.write, sql, params);
    },
    coldStore,
    isClosedDatabaseError,
  };
}

export async function getMemoryContentAtRootHex(
  db: TursoDatabase,
  rootHex: string,
  namespace: string,
  memoryKey: string,
  coldStore?: ContentBlobColdStore,
): Promise<ContentAtRootHit[]> {
  const rows = await queryLwwArms(db, rootHex, { namespace, memoryKey });
  if (coldStore === undefined) return hitsFromHot(rows);
  return resolveLwwRows(tursoOutboxDeps(db, coldStore), rows);
}

export async function reconstructStoreAtRootHex(
  db: TursoDatabase,
  rootHex: string,
  coldStore?: ContentBlobColdStore,
): Promise<ContentAtRootHit[]> {
  const rows = await queryLwwArms(db, rootHex, null);
  if (coldStore === undefined) return hitsFromHot(rows);
  return resolveLwwRows(tursoOutboxDeps(db, coldStore), rows);
}

export async function evacuateContentBlobsOutsideHotWindow(
  db: TursoDatabase,
  opts?: {
    retentionTips?: number;
    coldStore?: ContentBlobColdStore;
    allowDropWithoutColdStore?: boolean;
  },
): Promise<void> {
  await evacuateContentBlobsOutsideHotWindowWith(tursoOutboxDeps(db, opts?.coldStore), opts);
}

function isClosedDatabaseError(err: unknown): boolean {
  return (
    err instanceof Error &&
    /closed database|database has been closed|cannot use a closed database|connection.*(closed|reset)|CLIENT_CLOSED|HsDisconnected/i.test(
      err.message,
    )
  );
}
