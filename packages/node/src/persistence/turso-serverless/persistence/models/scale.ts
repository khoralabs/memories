import {
  type AuditCommitRow,
  computeAuditCommitId,
  mapAuditCommitRow,
  SQL_GET_AUDIT_COMMIT,
  SQL_INSERT_AUDIT_COMMIT,
  SQL_LIST_AUDIT_COMMIT_CHILDREN,
} from "../../../core/audit-commit";
import { sha256Hex } from "../../../core/models/sha256";
import type { SearchIndexOutboxItem, SearchIndexOutboxKind } from "../../../core/persistence/types";
import type { MemoryProvenanceEvent } from "../../../core/provenance";
import { canonicalJson } from "../../../core/provenance";
import {
  DEFAULT_SEARCH_INDEX_DRAIN_LIMIT,
  SQL_COUNT_SEARCH_INDEX_OUTBOX,
  SQL_DELETE_SEARCH_INDEX_OUTBOX,
  SQL_INSERT_SEARCH_INDEX_OUTBOX,
  SQL_PENDING_SEARCH_INDEX_OUTBOX_FOR_KEY,
  SQL_SELECT_SEARCH_INDEX_OUTBOX,
} from "../../../core/search-index-outbox/schema-sql";
import {
  bucketEntriesFromRows,
  bucketEntriesJson,
  bucketRootsFromRows,
  computeBucketRoot,
  computeStateRoot,
  diffStateEntries,
  parseStateEntryKey,
  planMemoryStateEntries,
  SQL_STATE_BUCKET_ENTRIES,
  SQL_STATE_BUCKET_ROOTS,
  SQL_STATE_DELETE_BUCKET_ROOT,
  SQL_STATE_DELETE_ENTRY,
  SQL_STATE_DELETE_ENTRY_BY_KEY,
  SQL_STATE_ENTRIES_BY_NAMESPACES_PREFIX,
  SQL_STATE_GET_BUCKET,
  SQL_STATE_GET_SNAPSHOT,
  SQL_STATE_MEMORY_SOURCE_KEYS,
  SQL_STATE_PUT_BUCKET,
  SQL_STATE_PUT_SNAPSHOT,
  SQL_STATE_SET_BUCKET_ROOT,
  SQL_STATE_UPSERT_ENTRY,
  type StateEntry,
  type StateRootDiffEntry,
  type StateTreeMutation,
  stateBucketOf,
  stateEntryKey,
} from "../../../core/state-tree";
import type { DbCtx } from "../context";
import { ctxExec, ctxQueryAll, ctxQueryOne } from "../db";
import { placeholders } from "../sql";

export async function enqueueSearchIndexOutbox(
  ctx: DbCtx,
  input: { namespace: string; memoryKey: string; causeId?: string; kinds: readonly string[] },
): Promise<{ enqueuedIds: string[] }> {
  const enqueuedIds: string[] = [];
  for (const kind of input.kinds) {
    const id = `sio_${crypto.randomUUID()}`;
    await ctxExec(ctx, SQL_INSERT_SEARCH_INDEX_OUTBOX, [
      id,
      ctx.now,
      input.namespace,
      input.memoryKey,
      input.causeId ?? null,
      kind,
    ]);
    enqueuedIds.push(id);
  }
  return { enqueuedIds };
}

export async function hasPendingSearchIndexOutbox(
  ctx: DbCtx,
  namespace: string,
  memoryKey: string,
): Promise<boolean> {
  return (
    (await ctxQueryOne(ctx, SQL_PENDING_SEARCH_INDEX_OUTBOX_FOR_KEY, [namespace, memoryKey])) !=
    null
  );
}

/** Applies each distinct (kind, key) once per batch, then deletes the batch. */
export async function drainSearchIndexOutbox(
  ctx: DbCtx,
  limit: number | undefined,
  apply: (item: SearchIndexOutboxItem) => Promise<void>,
): Promise<{ drained: SearchIndexOutboxItem[]; remaining: number }> {
  const rows = await ctxQueryAll<{
    id: string;
    namespace: string;
    memoryKey: string;
    causeId: string | null;
    kind: string;
  }>(ctx, SQL_SELECT_SEARCH_INDEX_OUTBOX, [limit ?? DEFAULT_SEARCH_INDEX_DRAIN_LIMIT]);
  const drained = rows.map(({ causeId, kind, ...r }) => ({
    ...r,
    ...(causeId !== null ? { causeId } : {}),
    kind: kind as SearchIndexOutboxKind,
  }));
  const seen = new Set<string>();
  for (const item of drained) {
    const key = `${item.kind}\0${item.namespace}\0${item.memoryKey}`;
    if (!seen.has(key)) {
      seen.add(key);
      await apply(item);
    }
    await ctxExec(ctx, SQL_DELETE_SEARCH_INDEX_OUTBOX, [item.id]);
  }
  const remaining = Number(
    (await ctxQueryOne<{ n: number }>(ctx, SQL_COUNT_SEARCH_INDEX_OUTBOX))?.n ?? 0,
  );
  return { drained, remaining };
}

async function bucketRoots(ctx: DbCtx): Promise<Record<number, string>> {
  return bucketRootsFromRows(
    await ctxQueryAll<{ bucket: number; rootHex: string }>(ctx, SQL_STATE_BUCKET_ROOTS),
  );
}

export async function getStateRootHex(ctx: DbCtx): Promise<string | undefined> {
  return computeStateRoot(await bucketRoots(ctx));
}

async function rehashTouchedBuckets(
  ctx: DbCtx,
  touched: ReadonlySet<number>,
): Promise<{ stateRootHex?: string }> {
  for (const bucket of touched) {
    const rows = await ctxQueryAll<{
      namespace: string;
      memoryKey: string;
      sourceKey: string;
      valueHash: string;
    }>(ctx, SQL_STATE_BUCKET_ENTRIES, [bucket]);
    if (rows.length === 0) {
      await ctxExec(ctx, SQL_STATE_DELETE_BUCKET_ROOT, [bucket]);
      continue;
    }
    const json = bucketEntriesJson(bucketEntriesFromRows(rows));
    const root = computeBucketRoot(json);
    await ctxExec(ctx, SQL_STATE_PUT_BUCKET, [root, json]);
    await ctxExec(ctx, SQL_STATE_SET_BUCKET_ROOT, [bucket, root]);
  }
  const roots = await bucketRoots(ctx);
  const stateRootHex = computeStateRoot(roots);
  if (stateRootHex !== undefined) {
    await ctxExec(ctx, SQL_STATE_PUT_SNAPSHOT, [stateRootHex, canonicalJson(roots)]);
  }
  return { stateRootHex };
}

export async function applyStateTreeMutations(
  ctx: DbCtx,
  mutations: readonly StateTreeMutation[],
): Promise<{ stateRootHex?: string }> {
  const touched = new Set<number>();
  for (const m of mutations) {
    const existing =
      m.replace === false
        ? []
        : (
            await ctxQueryAll<{ sourceKey: string }>(ctx, SQL_STATE_MEMORY_SOURCE_KEYS, [
              m.namespace,
              m.memoryKey,
            ])
          ).map((r) => r.sourceKey);
    const { upserts, deletes } = planMemoryStateEntries(m, existing);
    for (const u of upserts) {
      await ctxExec(ctx, SQL_STATE_UPSERT_ENTRY, [
        u.entryId,
        u.bucket,
        m.namespace,
        m.memoryKey,
        u.sourceKey,
        u.valueHash,
      ]);
      touched.add(u.bucket);
    }
    for (const d of deletes) {
      await ctxExec(ctx, SQL_STATE_DELETE_ENTRY, [m.namespace, m.memoryKey, d.sourceKey]);
      touched.add(d.bucket);
    }
  }
  return rehashTouchedBuckets(ctx, touched);
}

/** Remap state-tree leaves when namespace paths change (ADR 0002). */
export async function remapStateTreeNamespaces(
  ctx: DbCtx,
  nsMap: ReadonlyMap<string, string>,
): Promise<{ stateRootHex?: string }> {
  if (nsMap.size === 0) return {};
  const sources = [...nsMap.keys()];
  const rows = await ctxQueryAll<{
    entryKey: string;
    bucket: number;
    namespace: string;
    memoryKey: string;
    sourceKey: string;
    valueHash: string;
  }>(ctx, `${SQL_STATE_ENTRIES_BY_NAMESPACES_PREFIX} (${placeholders(sources.length)})`, sources);
  const touched = new Set<number>();
  for (const r of rows) {
    const newNs = nsMap.get(r.namespace);
    if (newNs === undefined || newNs === r.namespace) continue;
    touched.add(r.bucket);
    await ctxExec(ctx, SQL_STATE_DELETE_ENTRY_BY_KEY, [r.entryKey]);
    const newLogical = stateEntryKey(newNs, r.memoryKey, r.sourceKey);
    const entryId = sha256Hex(newLogical);
    const bucket = stateBucketOf(newLogical);
    await ctxExec(ctx, SQL_STATE_UPSERT_ENTRY, [
      entryId,
      bucket,
      newNs,
      r.memoryKey,
      r.sourceKey,
      r.valueHash,
    ]);
    touched.add(bucket);
  }
  return rehashTouchedBuckets(ctx, touched);
}

async function snapshotRoots(ctx: DbCtx, stateRootHex: string): Promise<Record<number, string>> {
  const row = await ctxQueryOne<{ json: string }>(ctx, SQL_STATE_GET_SNAPSHOT, [stateRootHex]);
  return row ? JSON.parse(row.json) : {};
}

async function bucketEntries(ctx: DbCtx, rootHex: string | undefined): Promise<StateEntry[]> {
  if (rootHex === undefined) return [];
  const row = await ctxQueryOne<{ json: string }>(ctx, SQL_STATE_GET_BUCKET, [rootHex]);
  return row ? JSON.parse(row.json) : [];
}

export async function listStateEntriesAtStateRootHex(
  ctx: DbCtx,
  stateRootHex: string,
  namespace?: string,
  memoryKey?: string,
) {
  const entries: StateEntry[] = [];
  for (const root of Object.values(await snapshotRoots(ctx, stateRootHex))) {
    entries.push(...(await bucketEntries(ctx, root)));
  }
  return entries
    .map(([k, valueHash]) => ({ ...parseStateEntryKey(k), valueHash }))
    .filter(
      (e) =>
        (namespace === undefined || e.namespace === namespace) &&
        (memoryKey === undefined || e.memoryKey === memoryKey),
    );
}

export async function diffStateRoots(
  ctx: DbCtx,
  from: string,
  to: string,
): Promise<StateRootDiffEntry[]> {
  const a = await snapshotRoots(ctx, from);
  const b = await snapshotRoots(ctx, to);
  const out: StateRootDiffEntry[] = [];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const ka = k as unknown as number;
    if (a[ka] === b[ka]) continue;
    out.push(...diffStateEntries(await bucketEntries(ctx, a[ka]), await bucketEntries(ctx, b[ka])));
  }
  return out;
}

export async function appendAuditCommit(
  ctx: DbCtx,
  input: { parents: readonly string[]; stateRootHex: string; event: MemoryProvenanceEvent },
): Promise<{ commitId: string }> {
  const commitId = computeAuditCommitId(input);
  await ctxExec(ctx, SQL_INSERT_AUDIT_COMMIT, [
    commitId,
    ctx.now,
    JSON.stringify(input.parents),
    input.stateRootHex,
    canonicalJson(input.event),
  ]);
  return { commitId };
}

export async function getAuditCommit(ctx: DbCtx, commitId: string) {
  const row = await ctxQueryOne<AuditCommitRow>(ctx, SQL_GET_AUDIT_COMMIT, [commitId]);
  return row ? mapAuditCommitRow(row) : undefined;
}

export async function listAuditCommitChildren(ctx: DbCtx, parentCommitId: string) {
  return (
    await ctxQueryAll<AuditCommitRow>(ctx, SQL_LIST_AUDIT_COMMIT_CHILDREN, [parentCommitId])
  ).map(mapAuditCommitRow);
}
