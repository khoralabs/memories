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
  test("initial migration creates the current schema and records tracking", () => {
    ensureCustomSqliteForExtensions();
    const db = new Database(":memory:");
    loadSqliteVec(db);

    initMemoriesSchema(db);

    const sourceMaps = tableColumns(db, "source_maps");
    expect(sourceMaps.has("content_hash")).toBe(true);

    const memories = tableColumns(db, "memories");
    expect(memories.has("kind")).toBe(true);
    expect(memories.has("edge_id")).toBe(true);

    const rows = trackingRows(db);
    expect(rows).toEqual([{ from_version: "0.0.0", to_version: "0.1.0", name: "001-initial" }]);

    const ftsSql = db
      .query<{ sql: string | null }, []>(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'text_features_fts'",
      )
      .get()?.sql;
    expect(ftsSql ?? "").toMatch(/\bporter\b/i);
  });
});
