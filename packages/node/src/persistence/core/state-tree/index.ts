import { sha256Digest, sha256Hex } from "../models/sha256";
import { canonicalJson } from "../provenance";

const enc = new TextEncoder();

export const MEMORIES_STATE_BUCKET_V1_PREFIX = "MEMORIES_STATE_BUCKET_v1\0";
export const MEMORIES_STATE_ROOT_V1_PREFIX = "MEMORIES_STATE_ROOT_v1\0";

/** One memory's user-content leaves; `replace` drops entries for the memory not listed. */
export type StateTreeMutation = {
  namespace: string;
  memoryKey: string;
  /** `source_key` → `content_hash` (user content only). */
  contentHashes: Record<string, string>;
  replace?: boolean;
};

export type StateRootDiffEntry = {
  namespace: string;
  memoryKey: string;
  sourceKey: string;
  contentHash?: string;
  change: "upsert" | "delete";
};

export type StateEntry = readonly [entryKey: string, valueHash: string];

export const stateEntryKey = (namespace: string, memoryKey: string, sourceKey: string) =>
  `${namespace}\0${memoryKey}\0${sourceKey}`;

export function parseStateEntryKey(entryKey: string) {
  const [namespace = "", memoryKey = "", sourceKey = ""] = entryKey.split("\0");
  return { namespace, memoryKey, sourceKey };
}

/** First byte of `sha256(entryKey)` → 256 buckets. */
export const stateBucketOf = (entryKey: string): number =>
  sha256Digest(enc.encode(entryKey))[0] as number;

/** Canonical bucket body (sorted) and its content address. */
export function bucketEntriesJson(entries: readonly StateEntry[]): string {
  return JSON.stringify([...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

export const computeBucketRoot = (entriesJson: string): string =>
  sha256Hex(`${MEMORIES_STATE_BUCKET_V1_PREFIX}${entriesJson}`);

/** Order-independent state root over non-empty bucket roots; `undefined` when the tree is empty. */
export function computeStateRoot(bucketRoots: Record<number, string>): string | undefined {
  return Object.keys(bucketRoots).length === 0
    ? undefined
    : sha256Hex(`${MEMORIES_STATE_ROOT_V1_PREFIX}${canonicalJson(bucketRoots)}`);
}

/**
 * Entry upserts/deletes needed so `existingSourceKeys` (same memory) matches `m`.
 * Rows are keyed by `sha256(entryKey)` hex so stored keys never contain NUL.
 */
export function planMemoryStateEntries(
  m: StateTreeMutation,
  existingSourceKeys: readonly string[],
) {
  const bucketOf = (sourceKey: string) =>
    stateBucketOf(stateEntryKey(m.namespace, m.memoryKey, sourceKey));
  const upserts = Object.entries(m.contentHashes).map(([sourceKey, valueHash]) => ({
    entryId: sha256Hex(stateEntryKey(m.namespace, m.memoryKey, sourceKey)),
    bucket: bucketOf(sourceKey),
    sourceKey,
    valueHash,
  }));
  const deletes =
    m.replace === false
      ? []
      : existingSourceKeys
          .filter((k) => !Object.hasOwn(m.contentHashes, k))
          .map((sourceKey) => ({ sourceKey, bucket: bucketOf(sourceKey) }));
  return { upserts, deletes };
}

/** Leaf-level diff of two bucket bodies. */
export function diffStateEntries(
  from: readonly StateEntry[],
  to: readonly StateEntry[],
): StateRootDiffEntry[] {
  const a = new Map(from);
  const b = new Map(to);
  const out: StateRootDiffEntry[] = [];
  for (const [k, h] of b) {
    if (a.get(k) !== h) out.push({ ...parseStateEntryKey(k), contentHash: h, change: "upsert" });
  }
  for (const k of a.keys()) {
    if (!b.has(k)) out.push({ ...parseStateEntryKey(k), change: "delete" });
  }
  return out;
}

export const STATE_TREE_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS "memory_state_entries" (
  "entry_key" TEXT PRIMARY KEY NOT NULL,
  "bucket" INTEGER NOT NULL,
  "namespace" TEXT NOT NULL,
  "memory_key" TEXT NOT NULL,
  "source_key" TEXT NOT NULL,
  "value_hash" TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_memory_state_entries_memory"
  ON "memory_state_entries" ("namespace", "memory_key");
CREATE INDEX IF NOT EXISTS "idx_memory_state_entries_bucket"
  ON "memory_state_entries" ("bucket");
CREATE TABLE IF NOT EXISTS "memory_state_bucket_roots" (
  "bucket" INTEGER PRIMARY KEY NOT NULL,
  "root_hex" TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS "memory_state_buckets" (
  "root_hex" TEXT PRIMARY KEY NOT NULL,
  "entries_json" TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS "memory_state_snapshots" (
  "state_root_hex" TEXT PRIMARY KEY NOT NULL,
  "bucket_roots_json" TEXT NOT NULL
);
`.trim();

export const SQL_STATE_MEMORY_SOURCE_KEYS = `SELECT source_key AS sourceKey FROM memory_state_entries WHERE namespace = ? AND memory_key = ?`;
export const SQL_STATE_UPSERT_ENTRY = `INSERT OR REPLACE INTO memory_state_entries (entry_key, bucket, namespace, memory_key, source_key, value_hash) VALUES (?, ?, ?, ?, ?, ?)`;
export const SQL_STATE_DELETE_ENTRY = `DELETE FROM memory_state_entries WHERE namespace = ? AND memory_key = ? AND source_key = ?`;
export const SQL_STATE_DELETE_ENTRY_BY_KEY = `DELETE FROM memory_state_entries WHERE entry_key = ?`;
export const SQL_STATE_BUCKET_ENTRIES = `SELECT namespace, memory_key AS memoryKey, source_key AS sourceKey, value_hash AS valueHash FROM memory_state_entries WHERE bucket = ?`;
/** Select entries for remapping; append `IN (?,?,…)` placeholders at call site. */
export const SQL_STATE_ENTRIES_BY_NAMESPACES_PREFIX = `SELECT entry_key AS entryKey, bucket, namespace, memory_key AS memoryKey, source_key AS sourceKey, value_hash AS valueHash FROM memory_state_entries WHERE namespace IN`;

/** Bucket body entries from `SQL_STATE_BUCKET_ENTRIES` rows. */
export const bucketEntriesFromRows = (
  rows: ReadonlyArray<{
    namespace: string;
    memoryKey: string;
    sourceKey: string;
    valueHash: string;
  }>,
): StateEntry[] =>
  rows.map((r) => [stateEntryKey(r.namespace, r.memoryKey, r.sourceKey), r.valueHash]);
export const SQL_STATE_PUT_BUCKET = `INSERT OR IGNORE INTO memory_state_buckets (root_hex, entries_json) VALUES (?, ?)`;
export const SQL_STATE_SET_BUCKET_ROOT = `INSERT OR REPLACE INTO memory_state_bucket_roots (bucket, root_hex) VALUES (?, ?)`;
export const SQL_STATE_DELETE_BUCKET_ROOT = `DELETE FROM memory_state_bucket_roots WHERE bucket = ?`;
export const SQL_STATE_BUCKET_ROOTS = `SELECT bucket, root_hex AS rootHex FROM memory_state_bucket_roots`;
export const SQL_STATE_PUT_SNAPSHOT = `INSERT OR IGNORE INTO memory_state_snapshots (state_root_hex, bucket_roots_json) VALUES (?, ?)`;
export const SQL_STATE_GET_SNAPSHOT = `SELECT bucket_roots_json AS json FROM memory_state_snapshots WHERE state_root_hex = ?`;
export const SQL_STATE_GET_BUCKET = `SELECT entries_json AS json FROM memory_state_buckets WHERE root_hex = ?`;
export const SQL_STATE_SOURCE_MAP_HASH = `SELECT content_hash AS contentHash FROM source_maps WHERE _id = ?`;

export function bucketRootsFromRows(
  rows: ReadonlyArray<{ bucket: number; rootHex: string }>,
): Record<number, string> {
  return Object.fromEntries(rows.map((r) => [Number(r.bucket), r.rootHex]));
}
