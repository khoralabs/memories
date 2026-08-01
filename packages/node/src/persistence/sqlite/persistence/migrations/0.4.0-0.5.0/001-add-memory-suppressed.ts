import type { Migration } from "@khoralabs/sqlite-migrate";

export default {
  from: "0.4.0",
  to: "0.5.0",
  name: "001-add-memory-suppressed",
  up(db) {
    const cols = db
      .query<{ name: string }, []>(`PRAGMA table_info(memories)`)
      .all()
      .map((r) => r.name);
    if (!cols.includes("suppressed")) {
      db.run(`ALTER TABLE memories ADD COLUMN suppressed INTEGER NOT NULL DEFAULT 0`);
    }
  },
} satisfies Migration;
