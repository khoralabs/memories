import type { Migration } from "@khoralabs/sqlite-migrate";
import {
  MIGRATE_CONTENT_TO_TIP_OUTBOX_SQL,
  TIP_BLOBS_TABLE_SQL,
  TIP_OUTBOX_TABLE_SQL,
} from "../../../../core/tip-outbox/schema-sql";

export default {
  from: "0.8.0",
  to: "0.9.0",
  name: "001-add-tip-outbox",
  up(db) {
    for (const stmt of [TIP_OUTBOX_TABLE_SQL, TIP_BLOBS_TABLE_SQL]) {
      for (const part of stmt
        .split(";")
        .map((s) => s.trim())
        .filter((s) => s.length > 0)) {
        db.run(part);
      }
    }
    for (const stmt of MIGRATE_CONTENT_TO_TIP_OUTBOX_SQL.split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)) {
      db.run(stmt);
    }
  },
} satisfies Migration;
