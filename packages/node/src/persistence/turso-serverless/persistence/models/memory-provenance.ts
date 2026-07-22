import { ids } from "../../../../persistence/core";
import { memoriesPersistenceDocumentSchema } from "../../../../persistence/core/persistence";
import {
  canonicalJson,
  type MemoryProvenanceEvent,
  nextProvenanceRoot,
} from "../../../../persistence/core/provenance";
import { documentValidator } from "../_lib";
import type { DbCtx } from "../context";
import type { TursoDatabase } from "../db";
import { ctxExec, readQueryOne } from "../db";

const doc = documentValidator(memoriesPersistenceDocumentSchema, "memory_provenance");

export async function getProvenanceHeadRootHex(db: TursoDatabase): Promise<string | undefined> {
  const row = await readQueryOne<{ root_hex: string }>(
    db,
    `SELECT root_hex FROM memory_provenance ORDER BY _ts_created DESC, rowid DESC LIMIT 1`,
  );
  return row?.root_hex;
}

export async function getProvenanceTimestampMsForRootHex(
  db: TursoDatabase,
  rootHex: string,
): Promise<number | undefined> {
  const row = await readQueryOne<{ _ts_created: number }>(
    db,
    `SELECT _ts_created FROM memory_provenance WHERE root_hex = ? LIMIT 1`,
    [rootHex],
  );
  return row?._ts_created;
}

export async function appendProvenanceEvent(
  ctx: DbCtx,
  event: MemoryProvenanceEvent,
): Promise<{ root_hex: string }> {
  const head = await getProvenanceHeadRootHex(ctx.db);
  const { parent_root_hex, root_hex } = nextProvenanceRoot(head, event);
  const eventJson = canonicalJson(event);
  const event_type = event.kind;
  const intent_snapshot_id = event.intent_snapshot_id;
  const rowId = ids.provenance(parent_root_hex, eventJson);
  doc.parse({
    _id: rowId,
    _ts_created: ctx.now,
    parent_root_hex,
    root_hex,
    event_type,
    event_json: eventJson,
    ...(intent_snapshot_id !== undefined ? { intent_snapshot_id } : {}),
  });
  await ctxExec(
    ctx,
    `INSERT INTO memory_provenance (_id, _ts_created, parent_root_hex, root_hex, event_type, event_json, intent_snapshot_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [rowId, ctx.now, parent_root_hex, root_hex, event_type, eventJson, intent_snapshot_id ?? null],
  );
  return { root_hex };
}
