import type { Migration } from "@khoralabs/sqlite-migrate";

const CONTENT_OUTBOX_SQL = `
CREATE TABLE IF NOT EXISTS "memory_content_outbox" (
  "_id" TEXT PRIMARY KEY NOT NULL,
  "_ts_created" REAL NOT NULL,
  "root_hex" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "namespace" TEXT NOT NULL,
  "memory_key" TEXT NOT NULL,
  "source_key" TEXT,
  "text" TEXT
);
CREATE INDEX IF NOT EXISTS "idx_memory_content_outbox_root_hex"
  ON "memory_content_outbox" ("root_hex");
`.trim();

export default {
  from: "0.1.0",
  to: "0.2.0",
  name: "001-add-content-outbox",
  up(db) {
    db.run(CONTENT_OUTBOX_SQL);
  },
} satisfies Migration;
