import type { Migration } from "@khoralabs/sqlite-migrate";
import {
  DROP_CONTENT_OUTBOX_TABLES_SQL,
  MIGRATE_CONTENT_TO_TIP_OUTBOX_SQL,
} from "../../../../core/tip-outbox/schema-sql";

export default {
  from: "0.9.1",
  to: "0.10.0",
  name: "001-drop-content-outbox",
  up(db) {
    for (const stmt of MIGRATE_CONTENT_TO_TIP_OUTBOX_SQL.split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)) {
      db.run(stmt);
    }
    for (const stmt of DROP_CONTENT_OUTBOX_TABLES_SQL.split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)) {
      db.run(stmt);
    }
  },
} satisfies Migration;
