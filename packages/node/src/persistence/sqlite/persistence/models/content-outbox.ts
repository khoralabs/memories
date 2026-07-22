import type { Database } from "bun:sqlite";
import type { DbCtx } from "./context";

export type ContentAtRootHit = {
  namespace: string;
  memoryKey: string;
  sourceKey: string;
  text: string;
};

export function appendMergeOutboxEntries(
  ctx: DbCtx,
  input: {
    root_hex: string;
    namespace: string;
    memoryKey: string;
    entries: ReadonlyArray<{ sourceKey: string; text?: string }>;
  },
): void {
  const { now, stmts } = ctx;
  for (const entry of input.entries) {
    stmts.insertContentOutbox.run(
      `${input.root_hex}:${entry.sourceKey}`,
      now,
      input.root_hex,
      "MERGE_MEMORY",
      input.namespace,
      input.memoryKey,
      entry.sourceKey,
      entry.text ?? null,
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
  );
}

const CONTENT_AT_ROOT_CTE = `
  WITH target AS (
    SELECT rowid AS target_rowid FROM memory_provenance WHERE root_hex = ?
  ),
  eligible AS (
    SELECT p.root_hex, p.rowid AS prov_rowid
    FROM memory_provenance p, target
    WHERE p.rowid <= target.target_rowid
  ),
  last_event AS (
    SELECT o.namespace, o.memory_key, MAX(e.prov_rowid) AS last_prov_rowid
    FROM memory_content_outbox o
    JOIN eligible e ON e.root_hex = o.root_hex
    {{WHERE}}
    GROUP BY o.namespace, o.memory_key
  ),
  last_rows AS (
    SELECT o.namespace, o.memory_key, o.source_key, o.text, o.event_type
    FROM memory_content_outbox o
    JOIN eligible e ON e.root_hex = o.root_hex
    JOIN last_event le
      ON le.namespace = o.namespace
      AND le.memory_key = o.memory_key
      AND e.prov_rowid = le.last_prov_rowid
  )
  SELECT
    namespace,
    memory_key AS memoryKey,
    source_key AS sourceKey,
    text
  FROM last_rows
  WHERE event_type = 'MERGE_MEMORY'
    AND source_key IS NOT NULL
    AND text       IS NOT NULL
`;

/**
 * Reconstruct the text content of one memory as of the given provenance chain link.
 *
 * Returns one row per source key that had text content at that point.
 * Returns `[]` if the memory did not exist or had been deleted by `rootHex`.
 */
export function getMemoryContentAtRootHex(
  db: Database,
  rootHex: string,
  namespace: string,
  memoryKey: string,
): ContentAtRootHit[] {
  const sql = CONTENT_AT_ROOT_CTE.replace(
    "{{WHERE}}",
    "WHERE o.namespace = ? AND o.memory_key = ?",
  );
  return db
    .query<
      { namespace: string; memoryKey: string; sourceKey: string; text: string },
      [string, string, string]
    >(sql)
    .all(rootHex, namespace, memoryKey);
}

/**
 * Reconstruct the text content of **every memory in the entire store** as of the given
 * provenance chain link. Scans the full `memory_content_outbox` table.
 *
 * **Use this only for full store audits or export.** For point-in-time reads on a single
 * memory use {@link getMemoryContentAtRootHex} instead, which is scoped and cheap.
 *
 * Returns one row per (namespace, memoryKey, sourceKey) that had text content at `rootHex`.
 * Memories deleted before that chain link are absent from the result.
 */
export function reconstructStoreAtRootHex(db: Database, rootHex: string): ContentAtRootHit[] {
  const sql = CONTENT_AT_ROOT_CTE.replace("{{WHERE}}", "");
  return db
    .query<{ namespace: string; memoryKey: string; sourceKey: string; text: string }, [string]>(sql)
    .all(rootHex);
}
