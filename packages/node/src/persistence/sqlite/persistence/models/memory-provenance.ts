import type { Database } from "bun:sqlite";
import { ids } from "../../../../persistence/core";
import {
  buildProvenanceEventsQuery,
  mapProvenanceChainRow,
  mapProvenanceEventRow,
  normalizeProvenanceChainInput,
  type ProvenanceChainRow,
  type ProvenanceEventRow,
  SQL_PROVENANCE_CHAIN_BEFORE,
  SQL_PROVENANCE_CHAIN_FIRST,
  SQL_PROVENANCE_CHAIN_TIP,
  SQL_PROVENANCE_HEAD,
  SQL_PROVENANCE_TIMESTAMP,
} from "../../../../persistence/core/models/provenance-list-sql";
import { memoriesPersistenceDocumentSchema } from "../../../../persistence/core/persistence";
import type { MemoryContentAtRootItem } from "../../../../persistence/core/persistence/types";
import {
  canonicalJson,
  type MemoryProvenanceEvent,
  nextProvenanceRoot,
} from "../../../../persistence/core/provenance";
import { documentValidator } from "../_lib";
import type { DbCtx } from "./context";

export {
  clampProvenanceListLimit,
  isValidProvenanceCursorId,
  PROVENANCE_CURSOR_ID_MAX_LENGTH,
  PROVENANCE_LIST_LIMIT_MAX,
} from "../../../../persistence/core/models/provenance-list-sql";

const doc = documentValidator(memoriesPersistenceDocumentSchema, "memory_provenance");

export function getProvenanceHeadRootHex(db: Database): string | undefined {
  const row = db.query<{ root_hex: string }, []>(SQL_PROVENANCE_HEAD).get();
  return row?.root_hex;
}

export function getProvenanceTimestampMsForRootHex(
  db: Database,
  rootHex: string,
): number | undefined {
  const row = db.query<{ _ts_created: number }, [string]>(SQL_PROVENANCE_TIMESTAMP).get(rootHex);
  return row?._ts_created;
}

export function listProvenanceEvents(
  db: Database,
  input: {
    namespace?: string;
    key?: string;
    limit: number;
    before?: { createdAt: number; id: string };
  },
) {
  const { sql, params } = buildProvenanceEventsQuery(input);
  const rows = db.query(sql).all(...(params as never[])) as ProvenanceEventRow[];
  return rows.map(mapProvenanceEventRow);
}

export function listProvenanceChain(
  db: Database,
  input: { limit: number; beforeRootHex?: string },
) {
  const { limit, beforeRootHex } = normalizeProvenanceChainInput(input);

  if (beforeRootHex !== null) {
    const tip = db
      .query<{ _ts_created: number; _id: string }, [string]>(SQL_PROVENANCE_CHAIN_TIP)
      .get(beforeRootHex);
    if (tip === null || tip === undefined) return [];

    const rows = db
      .query<ProvenanceChainRow, [number, number, string, number]>(SQL_PROVENANCE_CHAIN_BEFORE)
      .all(tip._ts_created, tip._ts_created, tip._id, limit);
    return rows.map(mapProvenanceChainRow);
  }

  const rows = db.query<ProvenanceChainRow, [number]>(SQL_PROVENANCE_CHAIN_FIRST).all(limit);
  return rows.map(mapProvenanceChainRow);
}

/** Map LWW content hits to the public read shape (sourceKey + text only). */
export function toMemoryContentAtRootItems(
  hits: ReadonlyArray<{ sourceKey: string; text: string }>,
): MemoryContentAtRootItem[] {
  return hits.map((h) => ({ sourceKey: h.sourceKey, text: h.text }));
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
