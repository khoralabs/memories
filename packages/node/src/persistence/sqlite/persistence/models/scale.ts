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
import type { DbCtx } from "./context";

export function enqueueSearchIndexOutbox(
  ctx: DbCtx,
  input: { namespace: string; memoryKey: string; causeId?: string; kinds: readonly string[] },
): { enqueuedIds: string[] } {
  const enqueuedIds = input.kinds.map((kind) => {
    const id = `sio_${crypto.randomUUID()}`;
    ctx.db.run(SQL_INSERT_SEARCH_INDEX_OUTBOX, [
      id,
      ctx.now,
      input.namespace,
      input.memoryKey,
      input.causeId ?? null,
      kind,
    ]);
    return id;
  });
  return { enqueuedIds };
}

export function hasPendingSearchIndexOutbox(ctx: DbCtx, namespace: string, memoryKey: string) {
  return ctx.db.query(SQL_PENDING_SEARCH_INDEX_OUTBOX_FOR_KEY).get(namespace, memoryKey) != null;
}

/** Applies each distinct (kind, key) once per batch, then deletes the batch. */
export function drainSearchIndexOutbox(
  ctx: DbCtx,
  limit: number | undefined,
  apply: (item: SearchIndexOutboxItem) => void,
): { drained: SearchIndexOutboxItem[]; remaining: number } {
  const drained = ctx.db
    .query<
      { id: string; namespace: string; memoryKey: string; causeId: string | null; kind: string },
      [number]
    >(SQL_SELECT_SEARCH_INDEX_OUTBOX)
    .all(limit ?? DEFAULT_SEARCH_INDEX_DRAIN_LIMIT)
    .map(({ causeId, kind, ...r }) => ({
      ...r,
      ...(causeId !== null ? { causeId } : {}),
      kind: kind as SearchIndexOutboxKind,
    }));
  const seen = new Set<string>();
  for (const item of drained) {
    const key = `${item.kind}\0${item.namespace}\0${item.memoryKey}`;
    if (!seen.has(key)) {
      seen.add(key);
      apply(item);
    }
    ctx.db.run(SQL_DELETE_SEARCH_INDEX_OUTBOX, [item.id]);
  }
  const remaining = Number(
    ctx.db.query<{ n: number }, []>(SQL_COUNT_SEARCH_INDEX_OUTBOX).get()?.n ?? 0,
  );
  return { drained, remaining };
}

function bucketRoots(ctx: DbCtx): Record<number, string> {
  return bucketRootsFromRows(
    ctx.db.query<{ bucket: number; rootHex: string }, []>(SQL_STATE_BUCKET_ROOTS).all(),
  );
}

export function getStateRootHex(ctx: DbCtx): string | undefined {
  return computeStateRoot(bucketRoots(ctx));
}

function rehashTouchedBuckets(ctx: DbCtx, touched: ReadonlySet<number>): { stateRootHex?: string } {
  const { db } = ctx;
  for (const bucket of touched) {
    const rows = db
      .query<
        { namespace: string; memoryKey: string; sourceKey: string; valueHash: string },
        [number]
      >(SQL_STATE_BUCKET_ENTRIES)
      .all(bucket);
    if (rows.length === 0) {
      db.run(SQL_STATE_DELETE_BUCKET_ROOT, [bucket]);
      continue;
    }
    const json = bucketEntriesJson(bucketEntriesFromRows(rows));
    const root = computeBucketRoot(json);
    db.run(SQL_STATE_PUT_BUCKET, [root, json]);
    db.run(SQL_STATE_SET_BUCKET_ROOT, [bucket, root]);
  }
  const roots = bucketRoots(ctx);
  const stateRootHex = computeStateRoot(roots);
  if (stateRootHex !== undefined) {
    db.run(SQL_STATE_PUT_SNAPSHOT, [stateRootHex, canonicalJson(roots)]);
  }
  return { stateRootHex };
}

export function applyStateTreeMutations(
  ctx: DbCtx,
  mutations: readonly StateTreeMutation[],
): { stateRootHex?: string } {
  const { db } = ctx;
  const touched = new Set<number>();
  for (const m of mutations) {
    const existing =
      m.replace === false
        ? []
        : db
            .query<{ sourceKey: string }, [string, string]>(SQL_STATE_MEMORY_SOURCE_KEYS)
            .all(m.namespace, m.memoryKey)
            .map((r) => r.sourceKey);
    const { upserts, deletes } = planMemoryStateEntries(m, existing);
    for (const u of upserts) {
      db.run(SQL_STATE_UPSERT_ENTRY, [
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
      db.run(SQL_STATE_DELETE_ENTRY, [m.namespace, m.memoryKey, d.sourceKey]);
      touched.add(d.bucket);
    }
  }
  return rehashTouchedBuckets(ctx, touched);
}

/** Remap state-tree leaves when namespace paths change (ADR 0002). */
export function remapStateTreeNamespaces(
  ctx: DbCtx,
  nsMap: ReadonlyMap<string, string>,
): { stateRootHex?: string } {
  if (nsMap.size === 0) return {};
  const sources = [...nsMap.keys()];
  const placeholders = sources.map(() => "?").join(", ");
  const rows = ctx.db
    .query<
      {
        entryKey: string;
        bucket: number;
        namespace: string;
        memoryKey: string;
        sourceKey: string;
        valueHash: string;
      },
      string[]
    >(`${SQL_STATE_ENTRIES_BY_NAMESPACES_PREFIX} (${placeholders})`)
    .all(...sources);
  const touched = new Set<number>();
  for (const r of rows) {
    const newNs = nsMap.get(r.namespace);
    if (newNs === undefined || newNs === r.namespace) continue;
    touched.add(r.bucket);
    ctx.db.run(SQL_STATE_DELETE_ENTRY_BY_KEY, [r.entryKey]);
    const newLogical = stateEntryKey(newNs, r.memoryKey, r.sourceKey);
    const entryId = sha256Hex(newLogical);
    const bucket = stateBucketOf(newLogical);
    ctx.db.run(SQL_STATE_UPSERT_ENTRY, [
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

function snapshotRoots(ctx: DbCtx, stateRootHex: string): Record<number, string> {
  const row = ctx.db.query<{ json: string }, [string]>(SQL_STATE_GET_SNAPSHOT).get(stateRootHex);
  return row ? JSON.parse(row.json) : {};
}

function bucketEntries(ctx: DbCtx, rootHex: string | undefined): StateEntry[] {
  if (rootHex === undefined) return [];
  const row = ctx.db.query<{ json: string }, [string]>(SQL_STATE_GET_BUCKET).get(rootHex);
  return row ? JSON.parse(row.json) : [];
}

export function listStateEntriesAtStateRootHex(
  ctx: DbCtx,
  stateRootHex: string,
  namespace?: string,
  memoryKey?: string,
) {
  return Object.values(snapshotRoots(ctx, stateRootHex))
    .flatMap((root) => bucketEntries(ctx, root))
    .map(([k, valueHash]) => ({ ...parseStateEntryKey(k), valueHash }))
    .filter(
      (e) =>
        (namespace === undefined || e.namespace === namespace) &&
        (memoryKey === undefined || e.memoryKey === memoryKey),
    );
}

export function diffStateRoots(ctx: DbCtx, from: string, to: string): StateRootDiffEntry[] {
  const a = snapshotRoots(ctx, from);
  const b = snapshotRoots(ctx, to);
  const buckets = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...buckets].flatMap((k) => {
    const ka = k as unknown as number;
    return a[ka] === b[ka]
      ? []
      : diffStateEntries(bucketEntries(ctx, a[ka]), bucketEntries(ctx, b[ka]));
  });
}

export function appendAuditCommit(
  ctx: DbCtx,
  input: { parents: readonly string[]; stateRootHex: string; event: MemoryProvenanceEvent },
): { commitId: string } {
  const commitId = computeAuditCommitId(input);
  ctx.db.run(SQL_INSERT_AUDIT_COMMIT, [
    commitId,
    ctx.now,
    JSON.stringify(input.parents),
    input.stateRootHex,
    canonicalJson(input.event),
  ]);
  return { commitId };
}

export function getAuditCommit(ctx: DbCtx, commitId: string) {
  const row = ctx.db.query<AuditCommitRow, [string]>(SQL_GET_AUDIT_COMMIT).get(commitId);
  return row ? mapAuditCommitRow(row) : undefined;
}

export function listAuditCommitChildren(ctx: DbCtx, parentCommitId: string) {
  return ctx.db
    .query<AuditCommitRow, [string]>(SQL_LIST_AUDIT_COMMIT_CHILDREN)
    .all(parentCommitId)
    .map(mapAuditCommitRow);
}
