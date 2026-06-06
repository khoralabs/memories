import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { ensureCustomSqliteForExtensions, initMemoriesSchema, loadSqliteVec } from "./connection";

function tableColumns(db: Database, table: string): Set<string> {
  return new Set(
    db
      .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
      .all()
      .map((r) => r.name),
  );
}

function trackingRows(
  db: Database,
): Array<{ from_version: string; to_version: string; name: string }> {
  return db
    .query<{ from_version: string; to_version: string; name: string }, []>(
      "SELECT from_version, to_version, name FROM _schema_migrations ORDER BY from_version, to_version, name",
    )
    .all();
}

describe("memories sqlite migrations", () => {
  test("legacy memories table without kind/edge_id gets columns added and tracking rows recorded", () => {
    ensureCustomSqliteForExtensions();
    const db = new Database(":memory:");
    loadSqliteVec(db);

    db.run(`
      CREATE TABLE source_maps (
        _id TEXT PRIMARY KEY NOT NULL
      );
      CREATE TABLE memories (
        _id TEXT PRIMARY KEY NOT NULL,
        ns_prefix_1 TEXT,
        ns_prefix_2 TEXT,
        ns_prefix_3 TEXT,
        ns_prefix_4 TEXT,
        ns_prefix_5 TEXT,
        ns_prefix_6 TEXT
      );
    `);

    initMemoriesSchema(db);

    const sourceMaps = tableColumns(db, "source_maps");
    expect(sourceMaps.has("content_hash")).toBe(true);

    const memories = tableColumns(db, "memories");
    expect(memories.has("kind")).toBe(true);
    expect(memories.has("edge_id")).toBe(true);

    const rows = trackingRows(db);
    const names = rows.map((r) => `${r.from_version}->${r.to_version}/${r.name}`);
    expect(names).toContain("0.0.0->0.1.0/001-initial");
    expect(names).toContain("0.1.0->0.2.0/001-additive-columns");
    expect(names).toContain("0.2.0->0.3.0/001-fts-porter-rebuild");
  });

  test("fts-porter-rebuild migration recreates a non-porter FTS table", () => {
    ensureCustomSqliteForExtensions();
    const db = new Database(":memory:");
    loadSqliteVec(db);

    db.run(`
      CREATE TABLE text_features (
        _id TEXT PRIMARY KEY NOT NULL,
        memory_id TEXT,
        source_map_id TEXT,
        text TEXT
      );
      CREATE VIRTUAL TABLE text_features_fts USING fts5(
        text_feature_id UNINDEXED,
        memory_id UNINDEXED,
        source_map_id UNINDEXED,
        text,
        tokenize = 'unicode61'
      );
    `);
    db.run(
      `INSERT INTO text_features (_id, memory_id, source_map_id, text) VALUES ('t1', 'm1', 's1', 'porter loves facts')`,
    );

    initMemoriesSchema(db);

    const sql = db
      .query<{ sql: string | null }, []>(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'text_features_fts'",
      )
      .get()?.sql;
    expect(sql ?? "").toMatch(/\bporter\b/i);

    const row = db
      .query<{ text_feature_id: string }, []>(
        "SELECT text_feature_id FROM text_features_fts WHERE text_feature_id = 't1'",
      )
      .get();
    expect(row?.text_feature_id).toBe("t1");
  });
});
