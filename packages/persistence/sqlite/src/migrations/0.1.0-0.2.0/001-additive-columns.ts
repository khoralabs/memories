import type { Database } from "bun:sqlite";
import type { Migration } from "@khoralabs/sqlite-migrate";

function tableColumns(db: Database, table: string): Set<string> {
  return new Set(
    db
      .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
      .all()
      .map((r) => r.name),
  );
}

export default {
  from: "0.1.0",
  to: "0.2.0",
  name: "001-additive-columns",
  up(db) {
    const sourceMaps = tableColumns(db, "source_maps");
    if (!sourceMaps.has("content_hash")) {
      db.run("ALTER TABLE source_maps ADD COLUMN content_hash TEXT");
    }

    const memories = tableColumns(db, "memories");
    if (!memories.has("kind")) {
      db.run("ALTER TABLE memories ADD COLUMN kind TEXT NOT NULL DEFAULT 'node'");
    }
    if (!memories.has("edge_id")) {
      db.run("ALTER TABLE memories ADD COLUMN edge_id TEXT");
    }

    db.run(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_memories_edge_id_unique ON memories(edge_id) WHERE edge_id IS NOT NULL`,
    );
  },
} satisfies Migration;
