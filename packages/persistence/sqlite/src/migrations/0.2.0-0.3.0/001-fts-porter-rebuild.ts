import type { Migration } from "@khoralabs/sqlite-migrate";
import { TEXT_FEATURES_FTS_SQL } from "../../search-indexes";

/**
 * Rebuilds `text_features_fts` when an older table used `unicode61` only (no Porter),
 * so `fact`/`facts` align under FTS5 MATCH. Idempotent: only acts when the existing DDL lacks
 * `porter`; new DBs already created via the 0.0.0-0.1.0 initial migration are unaffected.
 */
export default {
  from: "0.2.0",
  to: "0.3.0",
  name: "001-fts-porter-rebuild",
  up(db) {
    const row = db
      .query<{ sql: string | null }, []>(
        `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'text_features_fts'`,
      )
      .get();

    const needsRebuild = row?.sql != null && !/\bporter\b/i.test(row.sql);
    if (!needsRebuild) {
      return;
    }

    db.run(`DROP TABLE IF EXISTS text_features_fts`);
    db.run(TEXT_FEATURES_FTS_SQL);
    db.run(`
      INSERT INTO text_features_fts (text_feature_id, memory_id, source_map_id, text)
      SELECT _id, memory_id, source_map_id, text FROM text_features
    `);
  },
} satisfies Migration;
