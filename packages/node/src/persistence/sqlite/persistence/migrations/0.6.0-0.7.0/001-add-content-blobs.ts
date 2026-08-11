import { createHash } from "node:crypto";
import type { Migration } from "@khoralabs/sqlite-migrate";

function sha256Hex(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

export default {
  from: "0.6.0",
  to: "0.7.0",
  name: "001-add-content-blobs",
  up(db) {
    db.run(`
CREATE TABLE IF NOT EXISTS "memory_content_blobs" (
  "content_sha256" TEXT PRIMARY KEY NOT NULL,
  "text" TEXT,
  "location" TEXT NOT NULL DEFAULT 'hot',
  "cold_uri" TEXT,
  "_ts_created" REAL NOT NULL
);
`);
    const cols = db
      .query<{ name: string }, []>(`PRAGMA table_info(memory_content_outbox)`)
      .all()
      .map((r) => r.name);
    if (!cols.includes("content_sha256")) {
      db.run(`ALTER TABLE memory_content_outbox ADD COLUMN content_sha256 TEXT`);
    }
    db.run(
      `CREATE INDEX IF NOT EXISTS "idx_memory_content_outbox_ns_key_source"
       ON "memory_content_outbox" ("namespace", "memory_key", "source_key")`,
    );

    const rows = db
      .query<{ _id: string; text: string }, []>(
        `SELECT _id, text FROM memory_content_outbox WHERE text IS NOT NULL AND length(text) > 0`,
      )
      .all();
    const now = Date.now();
    const insertBlob = db.prepare(
      `INSERT OR IGNORE INTO memory_content_blobs (content_sha256, text, location, cold_uri, _ts_created)
       VALUES (?, ?, 'hot', NULL, ?)`,
    );
    const updateOutbox = db.prepare(
      `UPDATE memory_content_outbox SET content_sha256 = ?, text = NULL WHERE _id = ?`,
    );
    for (const row of rows) {
      const hash = sha256Hex(row.text);
      insertBlob.run(hash, row.text, now);
      updateOutbox.run(hash, row._id);
    }
  },
} satisfies Migration;
