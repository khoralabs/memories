import type { Migration } from "@khoralabs/sqlite-migrate";

const NS_PREFIX_COLUMNS = [
  "ns_prefix_1",
  "ns_prefix_2",
  "ns_prefix_3",
  "ns_prefix_4",
  "ns_prefix_5",
  "ns_prefix_6",
] as const;

/**
 * Drop denormalized namespace prefix columns; pathSubtree filters use primary `namespace`.
 * Idempotent: skips DROP COLUMN when greenfield 0.1.0 already omitted the columns.
 */
export default {
  from: "0.3.0",
  to: "0.4.0",
  name: "001-drop-ns-prefix-columns",
  up(db) {
    db.run(`DROP INDEX IF EXISTS idx_memories_ns_prefixes`);
    const existing = new Set(
      db
        .query<{ name: string }, []>(`PRAGMA table_info(memories)`)
        .all()
        .map((r) => r.name),
    );
    for (const col of NS_PREFIX_COLUMNS) {
      if (existing.has(col)) {
        db.run(`ALTER TABLE memories DROP COLUMN ${col}`);
      }
    }
    db.run(`CREATE INDEX IF NOT EXISTS idx_memories_namespace ON memories (namespace)`);
  },
} satisfies Migration;
