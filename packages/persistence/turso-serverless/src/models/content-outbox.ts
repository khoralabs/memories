import type { DbCtx } from "../context";
import type { TursoDatabase } from "../db";
import { ctxExec, readQueryAll } from "../db";

export type ContentAtRootHit = {
  namespace: string;
  memoryKey: string;
  sourceKey: string;
  text: string;
};

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
    await ctxExec(
      ctx,
      `INSERT OR IGNORE INTO memory_content_outbox (_id, _ts_created, root_hex, event_type, namespace, memory_key, source_key, text)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        `${input.root_hex}:${entry.sourceKey}`,
        ctx.now,
        input.root_hex,
        "MERGE_MEMORY",
        input.namespace,
        input.memoryKey,
        entry.sourceKey,
        entry.text ?? null,
      ],
    );
  }
}

export async function appendDeleteOutboxEntry(
  ctx: DbCtx,
  input: { root_hex: string; namespace: string; memoryKey: string },
): Promise<void> {
  await ctxExec(
    ctx,
    `INSERT OR IGNORE INTO memory_content_outbox (_id, _ts_created, root_hex, event_type, namespace, memory_key, source_key, text)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      `${input.root_hex}:__delete__`,
      ctx.now,
      input.root_hex,
      "DELETE_MEMORY",
      input.namespace,
      input.memoryKey,
      null,
      null,
    ],
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

export async function getMemoryContentAtRootHex(
  db: TursoDatabase,
  rootHex: string,
  namespace: string,
  memoryKey: string,
): Promise<ContentAtRootHit[]> {
  const sql = CONTENT_AT_ROOT_CTE.replace(
    "{{WHERE}}",
    "WHERE o.namespace = ? AND o.memory_key = ?",
  );
  return readQueryAll<ContentAtRootHit>(db, sql, [rootHex, namespace, memoryKey]);
}

export async function reconstructStoreAtRootHex(
  db: TursoDatabase,
  rootHex: string,
): Promise<ContentAtRootHit[]> {
  const sql = CONTENT_AT_ROOT_CTE.replace("{{WHERE}}", "");
  return readQueryAll<ContentAtRootHit>(db, sql, [rootHex]);
}
