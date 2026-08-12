import { ids } from "../../../../persistence/core";
import { memoriesPersistenceDocumentSchema } from "../../../../persistence/core/persistence";
import type {
  ProvenanceChainLink,
  ProvenanceEventListItem,
} from "../../../../persistence/core/persistence/types";
import {
  canonicalJson,
  type MemoryProvenanceEvent,
  nextProvenanceRoot,
} from "../../../../persistence/core/provenance";
import { documentValidator } from "../_lib";
import type { DbCtx } from "../context";
import type { TursoDatabase } from "../db";
import { ctxExec, readQueryAll, readQueryOne } from "../db";

const doc = documentValidator(memoriesPersistenceDocumentSchema, "memory_provenance");

export const PROVENANCE_LIST_LIMIT_MAX = 100;

/** Soft cap for keyset cursor ids (stable ids are short; reject oversized clients). */
export const PROVENANCE_CURSOR_ID_MAX_LENGTH = 256;

export function clampProvenanceListLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit < 1) {
    throw new RangeError("provenance list limit must be a positive integer");
  }
  return Math.min(Math.floor(limit), PROVENANCE_LIST_LIMIT_MAX);
}

export function isValidProvenanceCursorId(id: string): boolean {
  return id.length > 0 && id.length <= PROVENANCE_CURSOR_ID_MAX_LENGTH;
}

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

export async function listProvenanceEvents(
  db: TursoDatabase,
  input: {
    namespace?: string;
    key?: string;
    limit: number;
    before?: { createdAt: number; id: string };
  },
): Promise<ProvenanceEventListItem[]> {
  if (input.key !== undefined && input.namespace === undefined) {
    throw new RangeError("listProvenanceEvents: key requires namespace");
  }
  const limit = clampProvenanceListLimit(input.limit);
  const ns = input.namespace ?? null;
  const key = input.key ?? null;
  const beforeCreated = input.before?.createdAt ?? null;
  const beforeIdRaw = input.before?.id ?? null;
  if (beforeIdRaw !== null && !isValidProvenanceCursorId(beforeIdRaw)) {
    throw new RangeError("listProvenanceEvents: before.id is invalid");
  }
  const beforeId = beforeIdRaw;

  const rows = await readQueryAll<{
    _id: string;
    root_hex: string;
    parent_root_hex: string;
    event_type: string;
    _ts_created: number;
    event_json: string;
    intent_snapshot_id: string | null;
  }>(
    db,
    `SELECT _id, root_hex, parent_root_hex, event_type, _ts_created, event_json, intent_snapshot_id
     FROM memory_provenance
     WHERE (
       ? IS NULL
       OR json_extract(event_json, '$.namespace') = ?
       OR json_extract(event_json, '$.from_namespace') = ?
       OR json_extract(event_json, '$.to_namespace') = ?
     )
       AND (? IS NULL OR json_extract(event_json, '$.memory_key') = ?)
       AND (
         ? IS NULL
         OR _ts_created < ?
         OR (_ts_created = ? AND _id < ?)
       )
     ORDER BY _ts_created DESC, _id DESC
     LIMIT ?`,
    [ns, ns, ns, ns, key, key, beforeCreated, beforeCreated, beforeCreated, beforeId, limit],
  );

  return rows.map((row) => ({
    id: row._id,
    rootHex: row.root_hex,
    parentRootHex: row.parent_root_hex,
    eventType: row.event_type,
    createdAt: row._ts_created,
    event: JSON.parse(row.event_json) as MemoryProvenanceEvent,
    ...(row.intent_snapshot_id != null ? { intentSnapshotId: row.intent_snapshot_id } : {}),
  }));
}

export async function listProvenanceChain(
  db: TursoDatabase,
  input: { limit: number; beforeRootHex?: string },
): Promise<ProvenanceChainLink[]> {
  const limit = clampProvenanceListLimit(input.limit);
  const beforeRootHex = input.beforeRootHex?.trim() || null;

  if (beforeRootHex !== null) {
    const tip = await readQueryOne<{ _ts_created: number; _id: string }>(
      db,
      `SELECT _ts_created, _id FROM memory_provenance WHERE root_hex = ? LIMIT 1`,
      [beforeRootHex],
    );
    if (tip === undefined) return [];

    const rows = await readQueryAll<{
      _id: string;
      root_hex: string;
      parent_root_hex: string;
      event_type: string;
      _ts_created: number;
    }>(
      db,
      `SELECT _id, root_hex, parent_root_hex, event_type, _ts_created
       FROM memory_provenance
       WHERE _ts_created < ?
          OR (_ts_created = ? AND _id < ?)
       ORDER BY _ts_created DESC, _id DESC
       LIMIT ?`,
      [tip._ts_created, tip._ts_created, tip._id, limit],
    );
    return rows.map((row) => ({
      id: row._id,
      rootHex: row.root_hex,
      parentRootHex: row.parent_root_hex,
      eventType: row.event_type,
      createdAt: row._ts_created,
    }));
  }

  const rows = await readQueryAll<{
    _id: string;
    root_hex: string;
    parent_root_hex: string;
    event_type: string;
    _ts_created: number;
  }>(
    db,
    `SELECT _id, root_hex, parent_root_hex, event_type, _ts_created
     FROM memory_provenance
     ORDER BY _ts_created DESC, _id DESC
     LIMIT ?`,
    [limit],
  );
  return rows.map((row) => ({
    id: row._id,
    rootHex: row.root_hex,
    parentRootHex: row.parent_root_hex,
    eventType: row.event_type,
    createdAt: row._ts_created,
  }));
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
