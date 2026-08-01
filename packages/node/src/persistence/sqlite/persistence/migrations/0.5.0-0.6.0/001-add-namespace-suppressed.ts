import type { Migration } from "@khoralabs/sqlite-migrate";

export default {
  from: "0.5.0",
  to: "0.6.0",
  name: "001-add-namespace-suppressed",
  up(db) {
    const cols = db
      .query<{ name: string }, []>(`PRAGMA table_info(namespace_metadata)`)
      .all()
      .map((r) => r.name);
    if (!cols.includes("suppressed")) {
      db.run(`ALTER TABLE namespace_metadata ADD COLUMN suppressed INTEGER NOT NULL DEFAULT 0`);
    }
  },
} satisfies Migration;
