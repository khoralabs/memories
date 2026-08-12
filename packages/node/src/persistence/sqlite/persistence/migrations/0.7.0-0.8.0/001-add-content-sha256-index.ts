import type { Migration } from "@khoralabs/sqlite-migrate";

export default {
  from: "0.7.0",
  to: "0.8.0",
  name: "001-add-content-sha256-index",
  up(db) {
    db.run(
      `CREATE INDEX IF NOT EXISTS "idx_memory_content_outbox_content_sha256"
       ON "memory_content_outbox" ("content_sha256")`,
    );
  },
} satisfies Migration;
