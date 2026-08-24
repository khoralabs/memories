import type { Migration } from "@khoralabs/sqlite-migrate";
import { MIGRATE_CONTENT_TO_TIP_OUTBOX_SQL } from "../../../../core/tip-outbox/schema-sql";

export default {
  from: "0.9.0",
  to: "0.9.1",
  name: "001-resync-content-to-tip-outbox",
  up(db) {
    for (const stmt of MIGRATE_CONTENT_TO_TIP_OUTBOX_SQL.split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)) {
      db.run(stmt);
    }
  },
} satisfies Migration;
