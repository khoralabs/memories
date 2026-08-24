import { ids } from "../../../../persistence/core";
import {
  buildProvenanceEventsQuery,
  mapProvenanceChainRow,
  mapProvenanceEventRow,
  normalizeProvenanceChainInput,
  type ProvenanceChainRow,
  type ProvenanceEventRow,
  SQL_INSERT_MEMORY_PROVENANCE,
  SQL_PROVENANCE_CHAIN_BEFORE,
  SQL_PROVENANCE_CHAIN_FIRST,
  SQL_PROVENANCE_CHAIN_TIP,
  SQL_PROVENANCE_HEAD,
  SQL_PROVENANCE_TIMESTAMP,
} from "../../../../persistence/core/models/provenance-list-sql";
import { memoriesPersistenceDocumentSchema } from "../../../../persistence/core/persistence";
import {
  canonicalJson,
  type MemoryProvenanceEvent,
  nextProvenanceRoot,
} from "../../../../persistence/core/provenance";
import { documentValidator } from "../_lib";
import type { DbCtx } from "../context";
import type { TursoDatabase } from "../db";
import { ctxExec, readQueryAll, readQueryOne } from "../db";
import { appendProvenanceFacetOutbox } from "./tip-outbox";

export {
  clampProvenanceListLimit,
  isValidProvenanceCursorId,
  PROVENANCE_CURSOR_ID_MAX_LENGTH,
  PROVENANCE_LIST_LIMIT_MAX,
} from "../../../../persistence/core/models/provenance-list-sql";

const doc = documentValidator(memoriesPersistenceDocumentSchema, "memory_provenance");

export async function getProvenanceHeadRootHex(db: TursoDatabase): Promise<string | undefined> {
  const row = await readQueryOne<{ root_hex: string }>(db, SQL_PROVENANCE_HEAD);
  return row?.root_hex;
}

export async function getProvenanceTimestampMsForRootHex(
  db: TursoDatabase,
  rootHex: string,
): Promise<number | undefined> {
  const row = await readQueryOne<{ _ts_created: number }>(db, SQL_PROVENANCE_TIMESTAMP, [rootHex]);
  return row?._ts_created;
}

export async function listProvenanceEvents(
  db: TursoDatabase,
  input: {
    namespace?: string;
    key?: string;
    limit: number;
    before?: { createdAt: number; id: string };
  },
) {
  const { sql, params } = buildProvenanceEventsQuery(input);
  const rows = await readQueryAll<ProvenanceEventRow>(db, sql, params);
  return rows.map(mapProvenanceEventRow);
}

export async function listProvenanceChain(
  db: TursoDatabase,
  input: { limit: number; beforeRootHex?: string },
) {
  const { limit, beforeRootHex } = normalizeProvenanceChainInput(input);

  if (beforeRootHex !== null) {
    const tip = await readQueryOne<{ _ts_created: number; _id: string }>(
      db,
      SQL_PROVENANCE_CHAIN_TIP,
      [beforeRootHex],
    );
    if (tip === undefined) return [];

    const rows = await readQueryAll<ProvenanceChainRow>(db, SQL_PROVENANCE_CHAIN_BEFORE, [
      tip._ts_created,
      tip._ts_created,
      tip._id,
      limit,
    ]);
    return rows.map(mapProvenanceChainRow);
  }

  const rows = await readQueryAll<ProvenanceChainRow>(db, SQL_PROVENANCE_CHAIN_FIRST, [limit]);
  return rows.map(mapProvenanceChainRow);
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
  await ctxExec(ctx, SQL_INSERT_MEMORY_PROVENANCE, [
    rowId,
    ctx.now,
    parent_root_hex,
    root_hex,
    event_type,
    eventJson,
    intent_snapshot_id ?? null,
  ]);
  await appendProvenanceFacetOutbox(ctx, { root_hex, event_type, eventJson });
  return { root_hex };
}
