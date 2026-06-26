import type { Database } from "bun:sqlite";
import { ids } from "@khoralabs/memories-persistence-core";
import { memoriesPersistenceDocumentSchema } from "@khoralabs/memories-persistence-core/persistence";
import {
  canonicalJson,
  type MemoryProvenanceEvent,
  nextProvenanceRoot,
} from "@khoralabs/memories-persistence-core/provenance";
import { documentValidator } from "../_lib";
import type { DbCtx } from "./context";

const doc = documentValidator(memoriesPersistenceDocumentSchema, "memory_provenance");

export function getProvenanceHeadRootHex(db: Database): string | undefined {
  const row = db
    .query<{ root_hex: string }, []>(
      // Tie-break with rowid: `_id` sort order is unrelated to chain order; same-ms merges must see latest link.
      `SELECT root_hex FROM memory_provenance ORDER BY _ts_created DESC, rowid DESC LIMIT 1`,
    )
    .get();
  return row?.root_hex;
}

export function getProvenanceTimestampMsForRootHex(
  db: Database,
  rootHex: string,
): number | undefined {
  const row = db
    .query<{ _ts_created: number }, [string]>(
      `SELECT _ts_created FROM memory_provenance WHERE root_hex = ? LIMIT 1`,
    )
    .get(rootHex);
  return row?._ts_created;
}

export function appendProvenanceEvent(
  ctx: DbCtx,
  event: MemoryProvenanceEvent,
): { root_hex: string } {
  const { db, now, stmts } = ctx;
  const head = getProvenanceHeadRootHex(db);
  const { parent_root_hex, root_hex } = nextProvenanceRoot(head, event);
  const eventJson = canonicalJson(event);
  const event_type = event.kind;
  const intent_snapshot_id = event.intent_snapshot_id;
  const rowId = ids.provenance(parent_root_hex, eventJson);
  doc.parse({
    _id: rowId,
    _ts_created: now,
    parent_root_hex,
    root_hex,
    event_type,
    event_json: eventJson,
    ...(intent_snapshot_id !== undefined ? { intent_snapshot_id } : {}),
  });
  stmts.insertMemoryProvenance.run(
    rowId,
    now,
    parent_root_hex,
    root_hex,
    event_type,
    eventJson,
    intent_snapshot_id ?? null,
  );
  return { root_hex };
}
