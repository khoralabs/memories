import type { Migration } from "@khoralabs/sqlite-migrate";
import { SCALE_SCHEMA_STATEMENTS } from "../../../../core/scale-schema-sql";

export default {
  from: "0.10.0",
  to: "0.11.0",
  name: "001-add-scale-tables",
  up(db) {
    for (const stmt of SCALE_SCHEMA_STATEMENTS) db.run(stmt);
  },
} satisfies Migration;
