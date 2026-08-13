import type { ProvenanceChainLink, ProvenanceEventListItem } from "../persistence/types";
import type { MemoryProvenanceEvent } from "../provenance";

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

/** Tie-break with rowid: `_id` sort order is unrelated to chain order. */
export const SQL_PROVENANCE_HEAD = `SELECT root_hex FROM memory_provenance ORDER BY _ts_created DESC, rowid DESC LIMIT 1`;

export const SQL_PROVENANCE_TIMESTAMP = `SELECT _ts_created FROM memory_provenance WHERE root_hex = ? LIMIT 1`;

export const SQL_PROVENANCE_EVENTS = `SELECT _id, root_hex, parent_root_hex, event_type, _ts_created, event_json, intent_snapshot_id
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
       LIMIT ?`;

export const SQL_PROVENANCE_CHAIN_TIP = `SELECT _ts_created, _id FROM memory_provenance WHERE root_hex = ? LIMIT 1`;

export const SQL_PROVENANCE_CHAIN_BEFORE = `SELECT _id, root_hex, parent_root_hex, event_type, _ts_created
         FROM memory_provenance
         WHERE _ts_created < ?
            OR (_ts_created = ? AND _id < ?)
         ORDER BY _ts_created DESC, _id DESC
         LIMIT ?`;

export const SQL_PROVENANCE_CHAIN_FIRST = `SELECT _id, root_hex, parent_root_hex, event_type, _ts_created
       FROM memory_provenance
       ORDER BY _ts_created DESC, _id DESC
       LIMIT ?`;

export const SQL_INSERT_MEMORY_PROVENANCE = `INSERT INTO memory_provenance (_id, _ts_created, parent_root_hex, root_hex, event_type, event_json, intent_snapshot_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`;

export type ProvenanceEventsListInput = {
  namespace?: string;
  key?: string;
  limit: number;
  before?: { createdAt: number; id: string };
};

export type ProvenanceEventRow = {
  _id: string;
  root_hex: string;
  parent_root_hex: string;
  event_type: string;
  _ts_created: number;
  event_json: string;
  intent_snapshot_id: string | null;
};

export type ProvenanceChainRow = {
  _id: string;
  root_hex: string;
  parent_root_hex: string;
  event_type: string;
  _ts_created: number;
};

/** Validate input and build bind params for {@link SQL_PROVENANCE_EVENTS}. */
export function buildProvenanceEventsQuery(input: ProvenanceEventsListInput): {
  sql: string;
  params: unknown[];
} {
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
  return {
    sql: SQL_PROVENANCE_EVENTS,
    params: [
      ns,
      ns,
      ns,
      ns,
      key,
      key,
      beforeCreated,
      beforeCreated,
      beforeCreated,
      beforeIdRaw,
      limit,
    ],
  };
}

export function mapProvenanceEventRow(row: ProvenanceEventRow): ProvenanceEventListItem {
  return {
    id: row._id,
    rootHex: row.root_hex,
    parentRootHex: row.parent_root_hex,
    eventType: row.event_type,
    createdAt: row._ts_created,
    event: JSON.parse(row.event_json) as MemoryProvenanceEvent,
    ...(row.intent_snapshot_id != null ? { intentSnapshotId: row.intent_snapshot_id } : {}),
  };
}

export function mapProvenanceChainRow(row: ProvenanceChainRow): ProvenanceChainLink {
  return {
    id: row._id,
    rootHex: row.root_hex,
    parentRootHex: row.parent_root_hex,
    eventType: row.event_type,
    createdAt: row._ts_created,
  };
}

export type ProvenanceChainListInput = { limit: number; beforeRootHex?: string };

/** Normalize chain list input; returns clamped limit and optional before tip hex. */
export function normalizeProvenanceChainInput(input: ProvenanceChainListInput): {
  limit: number;
  beforeRootHex: string | null;
} {
  return {
    limit: clampProvenanceListLimit(input.limit),
    beforeRootHex: input.beforeRootHex?.trim() || null,
  };
}
