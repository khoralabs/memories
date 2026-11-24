import { sha256Hex } from "../models/sha256";
import { canonicalJson, type MemoryProvenanceEvent } from "../provenance";

/** Domain prefix for audit commit ids (ADR 0002). */
export const MEMORIES_AUDIT_COMMIT_V1_PREFIX = "MEMORIES_AUDIT_COMMIT_v1\0";

/** `SHA-256(prefix || canonical_json({ parents, stateRootHex, event }))` as lowercase hex. */
export function computeAuditCommitId(input: {
  parents: readonly string[];
  stateRootHex: string;
  event: MemoryProvenanceEvent;
}): string {
  return sha256Hex(
    `${MEMORIES_AUDIT_COMMIT_V1_PREFIX}${canonicalJson({
      parents: input.parents,
      stateRootHex: input.stateRootHex,
      event: input.event,
    })}`,
  );
}

export const AUDIT_COMMIT_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS "memory_audit_commits" (
  "commit_id" TEXT PRIMARY KEY NOT NULL,
  "_ts_created" REAL NOT NULL,
  "parents_json" TEXT NOT NULL,
  "state_root_hex" TEXT NOT NULL,
  "event_json" TEXT NOT NULL
);
`.trim();

export const SQL_INSERT_AUDIT_COMMIT = `INSERT INTO memory_audit_commits (commit_id, _ts_created, parents_json, state_root_hex, event_json) VALUES (?, ?, ?, ?, ?)`;

const AUDIT_COMMIT_COLS = `commit_id AS commitId, _ts_created AS tsCreatedMs, parents_json AS parentsJson, state_root_hex AS stateRootHex, event_json AS eventJson`;

export const SQL_GET_AUDIT_COMMIT = `SELECT ${AUDIT_COMMIT_COLS} FROM memory_audit_commits WHERE commit_id = ?`;

export const SQL_LIST_AUDIT_COMMIT_CHILDREN = `SELECT ${AUDIT_COMMIT_COLS} FROM memory_audit_commits WHERE EXISTS (SELECT 1 FROM json_each(parents_json) WHERE value = ?) ORDER BY _ts_created ASC, rowid ASC`;

export type AuditCommitRow = {
  commitId: string;
  tsCreatedMs: number;
  parentsJson: string;
  stateRootHex: string;
  eventJson: string;
};

export function mapAuditCommitRow(r: AuditCommitRow) {
  return {
    commitId: r.commitId,
    parents: JSON.parse(r.parentsJson) as string[],
    stateRootHex: r.stateRootHex,
    event: JSON.parse(r.eventJson) as MemoryProvenanceEvent,
    tsCreatedMs: Number(r.tsCreatedMs),
  };
}
