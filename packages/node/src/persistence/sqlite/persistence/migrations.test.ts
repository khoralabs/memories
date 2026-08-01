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
    expect(memories.has("suppressed")).toBe(true);
    expect(memories.has("ns_prefix_1")).toBe(false);

    const rows = trackingRows(db);
    expect(rows).toEqual([
      { from_version: "0.0.0", to_version: "0.1.0", name: "001-initial" },
      { from_version: "0.1.0", to_version: "0.2.0", name: "001-add-content-outbox" },
      { from_version: "0.2.0", to_version: "0.3.0", name: "001-add-namespace-metadata" },
      { from_version: "0.3.0", to_version: "0.4.0", name: "001-drop-ns-prefix-columns" },
      { from_version: "0.4.0", to_version: "0.5.0", name: "001-add-memory-suppressed" },
    ]);

    const nsIdx = db
      .query<{ name: string }, []>(
        `SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_memories_namespace'`,
      )
      .get();
    expect(nsIdx?.name).toBe("idx_memories_namespace");

    const outbox = tableColumns(db, "memory_content_outbox");
    expect(outbox.has("root_hex")).toBe(true);
    expect(outbox.has("text")).toBe(true);

    const namespaceMetadata = tableColumns(db, "namespace_metadata");
    expect(namespaceMetadata.has("display_name")).toBe(true);
    expect(namespaceMetadata.has("description")).toBe(true);

    const ftsSql = db
      .query<{ sql: string | null }, []>(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'text_features_fts'",
      )
      .get()?.sql;
    expect(ftsSql ?? "").toMatch(/\bporter\b/i);
  });
});
