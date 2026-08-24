import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  MEMORIES_SCHEMA_VERSION as LIBSQL_VERSION,
  migrations as libsqlMigrations,
} from "../../libsql/persistence/migrations";
import {
  MEMORIES_SCHEMA_VERSION as TURSO_VERSION,
  migrations as tursoMigrations,
} from "../../turso-serverless/persistence/migrations";
import {
  MIGRATE_CONTENT_TO_TIP_OUTBOX_SQL,
  TIP_BLOBS_TABLE_SQL,
  TIP_OUTBOX_TABLE_SQL,
} from "./schema-sql";

function runSqlParts(db: Database, sql: string): void {
  for (const part of sql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)) {
    db.run(part);
  }
}

describe("tip outbox schema-sql", () => {
  test("shared migrate SQL copies legacy content rows into tip tables", () => {
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
CREATE TABLE memory_content_blobs (
  content_sha256 TEXT PRIMARY KEY NOT NULL,
  text TEXT,
  location TEXT NOT NULL DEFAULT 'hot',
  cold_uri TEXT,
  _ts_created REAL NOT NULL
);
`);
    const hash = createHash("sha256").update("shared").digest("hex");
    db.run(`INSERT INTO memory_content_outbox VALUES (?, ?, ?, 'MERGE_MEMORY', ?, ?, ?, NULL, ?)`, [
      "id1",
      1,
      "bb".repeat(32),
      "ns",
      "k",
      "text",
      hash,
    ]);
    db.run(`INSERT INTO memory_content_blobs VALUES (?, ?, 'hot', NULL, ?)`, [hash, "shared", 1]);

    runSqlParts(db, TIP_OUTBOX_TABLE_SQL);
    runSqlParts(db, TIP_BLOBS_TABLE_SQL);
    runSqlParts(db, MIGRATE_CONTENT_TO_TIP_OUTBOX_SQL);

    const tip = db
      .query<{ facet: string; payload_sha256: string | null }, []>(
        `SELECT facet, payload_sha256 FROM memory_tip_outbox`,
      )
      .get();
    expect(tip?.facet).toBe("content");
    expect(tip?.payload_sha256).toBe(hash);
  });

  test("libsql and turso migrations register schema 0.9.0 tip outbox", () => {
    expect(LIBSQL_VERSION).toBe("0.9.0");
    expect(TURSO_VERSION).toBe("0.9.0");
    expect(libsqlMigrations.some((m) => m.to === "0.9.0" && m.name === "001-add-tip-outbox")).toBe(
      true,
    );
    expect(tursoMigrations.some((m) => m.to === "0.9.0" && m.name === "001-add-tip-outbox")).toBe(
      true,
    );
  });
});
