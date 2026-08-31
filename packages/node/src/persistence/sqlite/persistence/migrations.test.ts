import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { ensureCustomSqliteForExtensions, initMemoriesSchema, loadSqliteVec } from "./connection";
import m001AddContentBlobs from "./migrations/0.6.0-0.7.0/001-add-content-blobs";
import m001AddTipOutbox from "./migrations/0.8.0-0.9.0/001-add-tip-outbox";

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
      { from_version: "0.5.0", to_version: "0.6.0", name: "001-add-namespace-suppressed" },
      { from_version: "0.6.0", to_version: "0.7.0", name: "001-add-content-blobs" },
      { from_version: "0.7.0", to_version: "0.8.0", name: "001-add-content-sha256-index" },
      { from_version: "0.8.0", to_version: "0.9.0", name: "001-add-tip-outbox" },
      { from_version: "0.9.0", to_version: "0.9.1", name: "001-resync-content-to-tip-outbox" },
      { from_version: "0.9.1", to_version: "0.10.0", name: "001-drop-content-outbox" },
    ]);

    const nsIdx = db
      .query<{ name: string }, []>(
        `SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_memories_namespace'`,
      )
      .get();
    expect(nsIdx?.name).toBe("idx_memories_namespace");

    const contentOutboxGone = db
      .query<{ name: string }, []>(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memory_content_outbox'`,
      )
      .get();
    expect(contentOutboxGone).toBeNull();

    const contentBlobsGone = db
      .query<{ name: string }, []>(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memory_content_blobs'`,
      )
      .get();
    expect(contentBlobsGone).toBeNull();

    const tipOutbox = tableColumns(db, "memory_tip_outbox");
    expect(tipOutbox.has("facet")).toBe(true);
    expect(tipOutbox.has("payload_sha256")).toBe(true);
    expect(tipOutbox.has("edge_id")).toBe(true);

    const tipBlobs = tableColumns(db, "memory_tip_blobs");
    expect(tipBlobs.has("payload")).toBe(true);
    expect(tipBlobs.has("location")).toBe(true);

    const namespaceMetadata = tableColumns(db, "namespace_metadata");
    expect(namespaceMetadata.has("display_name")).toBe(true);
    expect(namespaceMetadata.has("description")).toBe(true);
    expect(namespaceMetadata.has("suppressed")).toBe(true);

    const ftsSql = db
      .query<{ sql: string | null }, []>(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'text_features_fts'",
      )
      .get()?.sql;
    expect(ftsSql ?? "").toMatch(/\bporter\b/i);
  });

  test("0.7.0 content-blobs migration backfills hashes and nulls inline text", () => {
    ensureCustomSqliteForExtensions();
    const db = new Database(":memory:");
    db.run(`
CREATE TABLE memory_content_outbox (
  _id TEXT PRIMARY KEY NOT NULL,
  _ts_created REAL NOT NULL,
  root_hex TEXT NOT NULL,
  event_type TEXT NOT NULL,
  namespace TEXT NOT NULL,
  memory_key TEXT NOT NULL,
  source_key TEXT,
  text TEXT
);
`);
    db.run(
      `INSERT INTO memory_content_outbox
         (_id, _ts_created, root_hex, event_type, namespace, memory_key, source_key, text)
       VALUES
         ('r1:a', 1, 'r1', 'MERGE_MEMORY', 'ns', 'm', 'a', 'hello'),
         ('r1:b', 1, 'r1', 'MERGE_MEMORY', 'ns', 'm', 'b', 'hello'),
         ('r2:__delete__', 2, 'r2', 'DELETE_MEMORY', 'ns', 'm', NULL, NULL)`,
    );

    m001AddContentBlobs.up(db);

    const hash = createHash("sha256").update("hello").digest("hex");
    const blob = db
      .query<{ text: string | null; location: string }, [string]>(
        `SELECT text, location FROM memory_content_blobs WHERE content_sha256 = ?`,
      )
      .get(hash);
    expect(blob?.text).toBe("hello");
    expect(blob?.location).toBe("hot");

    const blobCount = db
      .query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM memory_content_blobs`)
      .get()?.n;
    expect(blobCount).toBe(1);

    const mergeRows = db
      .query<{ content_sha256: string | null; text: string | null }, []>(
        `SELECT content_sha256, text FROM memory_content_outbox WHERE event_type = 'MERGE_MEMORY'`,
      )
      .all();
    expect(mergeRows).toHaveLength(2);
    for (const row of mergeRows) {
      expect(row.content_sha256).toBe(hash);
      expect(row.text).toBeNull();
    }

    expect(tableColumns(db, "memory_content_outbox").has("content_sha256")).toBe(true);
  });

  test("0.9.0 tip-outbox migration copies content outbox into unified tables", () => {
    ensureCustomSqliteForExtensions();
    const db = new Database(":memory:");
    db.run(`
CREATE TABLE memory_content_outbox (
  _id TEXT PRIMARY KEY NOT NULL,
  _ts_created REAL NOT NULL,
  root_hex TEXT NOT NULL,
  event_type TEXT NOT NULL,
  namespace TEXT NOT NULL,
  memory_key TEXT NOT NULL,
  source_key TEXT,
  text TEXT,
  content_sha256 TEXT
);
`);
    m001AddContentBlobs.up(db);
    const hash = createHash("sha256").update("tip-body").digest("hex");
    db.run(
      `INSERT INTO memory_content_outbox
        (_id, _ts_created, root_hex, event_type, namespace, memory_key, source_key, text, content_sha256)
       VALUES (?, ?, ?, 'MERGE_MEMORY', ?, ?, ?, NULL, ?)`,
      ["row1", 1, "aa".repeat(32), "ns", "k", "text", hash],
    );
    db.run(
      `INSERT INTO memory_content_blobs (content_sha256, text, location, cold_uri, _ts_created)
       VALUES (?, ?, 'hot', NULL, ?)`,
      [hash, "tip-body", 1],
    );

    m001AddTipOutbox.up(db);

    const tipRow = db
      .query<{ facet: string; payload_sha256: string | null }, []>(
        `SELECT facet, payload_sha256 FROM memory_tip_outbox WHERE _id = 'row1'`,
      )
      .get();
    expect(tipRow?.facet).toBe("content");
    expect(tipRow?.payload_sha256).toBe(hash);

    const tipBlob = db
      .query<{ payload: Uint8Array | null }, [string]>(
        `SELECT payload FROM memory_tip_blobs WHERE content_sha256 = ?`,
      )
      .get(hash);
    expect(new TextDecoder().decode(tipBlob?.payload ?? new Uint8Array())).toBe("tip-body");
  });
});
