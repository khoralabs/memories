import type { Migration } from "@khoralabs/sqlite-migrate";

const NAMESPACE_METADATA_SQL = `
CREATE TABLE IF NOT EXISTS "namespace_metadata" (
  "_id" TEXT PRIMARY KEY NOT NULL,
  "display_name" TEXT,
  "description" TEXT NOT NULL DEFAULT '',
  "suppressed" INTEGER NOT NULL DEFAULT 0,
  "_ts_created" REAL NOT NULL,
  "_ts_updated" REAL NOT NULL
);
`.trim();

export default {
  from: "0.2.0",
  to: "0.3.0",
  name: "001-add-namespace-metadata",
  up(db) {
    db.run(NAMESPACE_METADATA_SQL);
  },
} satisfies Migration;
