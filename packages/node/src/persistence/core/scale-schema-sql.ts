import { AUDIT_COMMIT_TABLE_SQL } from "./audit-commit";
import { SEARCH_INDEX_OUTBOX_TABLE_SQL } from "./search-index-outbox/schema-sql";
import { STATE_TREE_TABLES_SQL } from "./state-tree";

/** Schema 0.11.0 (ADR 0002): search-index outbox, state tree, audit commits. One statement per entry. */
export const SCALE_SCHEMA_STATEMENTS = [
  SEARCH_INDEX_OUTBOX_TABLE_SQL,
  STATE_TREE_TABLES_SQL,
  AUDIT_COMMIT_TABLE_SQL,
].flatMap((sql) =>
  sql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0),
);
