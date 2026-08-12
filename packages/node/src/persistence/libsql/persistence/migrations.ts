import { createHash } from "node:crypto";
import type { LibsqlDatabase } from "./client";
import { execMultiple, execSql, queryAll, queryOne } from "./client";
import {
  LIBSQL_PRAGMAS_SQL,
  SCHEMA_VERSION_TABLE_SQL,
  TEXT_FEATURES_FTS_SQL,
} from "./libsql-schema";
import {
  CONTENT_BLOBS_SQL,
  CONTENT_OUTBOX_CONTENT_SHA256_INDEX_SQL,
  CONTENT_OUTBOX_SQL,
  MEMORIES_INDEXES_SQL,
  MEMORIES_SCHEMA_SQL,
  NAMESPACE_METADATA_SQL,
} from "./schema";
import { batchWriteStatements } from "./transactions";

export const MEMORIES_SCHEMA_VERSION = "0.8.0";

const NS_PREFIX_COLUMNS = [
  "ns_prefix_1",
  "ns_prefix_2",
  "ns_prefix_3",
  "ns_prefix_4",
  "ns_prefix_5",
  "ns_prefix_6",
] as const;

type Migration = {
  to: string;
  name: string;
  statements?: string[];
  up?: (db: LibsqlDatabase) => Promise<void>;
};

function sha256Hex(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

async function dropNsPrefixColumns(db: LibsqlDatabase): Promise<void> {
  await execSql(db.client, `DROP INDEX IF EXISTS idx_memories_ns_prefixes`);
  const cols = await queryAll<{ name: string }>(db.client, `PRAGMA table_info(memories)`);
  const existing = new Set(cols.map((r) => r.name));
  for (const col of NS_PREFIX_COLUMNS) {
    if (existing.has(col)) {
      await execSql(db.client, `ALTER TABLE memories DROP COLUMN ${col}`);
    }
  }
  await execSql(
    db.client,
    `CREATE INDEX IF NOT EXISTS idx_memories_namespace ON memories (namespace)`,
  );
}

async function addContentBlobs(db: LibsqlDatabase): Promise<void> {
  for (const stmt of CONTENT_BLOBS_SQL.split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)) {
    await execSql(db.client, stmt);
  }
  const cols = await queryAll<{ name: string }>(
    db.client,
    `PRAGMA table_info(memory_content_outbox)`,
  );
  if (!cols.some((r) => r.name === "content_sha256")) {
    await execSql(db.client, `ALTER TABLE memory_content_outbox ADD COLUMN content_sha256 TEXT`);
  }
  const rows = await queryAll<{ _id: string; text: string }>(
    db.client,
    `SELECT _id, text FROM memory_content_outbox WHERE text IS NOT NULL AND length(text) > 0`,
  );
  const now = Date.now();
  for (const row of rows) {
    const hash = sha256Hex(row.text);
    await execSql(
      db.client,
      `INSERT OR IGNORE INTO memory_content_blobs (content_sha256, text, location, cold_uri, _ts_created)
       VALUES (?, ?, 'hot', NULL, ?)`,
      [hash, row.text, now],
    );
    await execSql(
      db.client,
      `UPDATE memory_content_outbox SET content_sha256 = ?, text = NULL WHERE _id = ?`,
      [hash, row._id],
    );
  }
}

const migrations: Migration[] = [
  {
    to: "0.1.0",
    name: "001-initial",
    statements: [
      LIBSQL_PRAGMAS_SQL,
      SCHEMA_VERSION_TABLE_SQL,
      MEMORIES_SCHEMA_SQL,
      MEMORIES_INDEXES_SQL,
      TEXT_FEATURES_FTS_SQL,
    ],
  },
  {
    to: "0.2.0",
    name: "001-add-content-outbox",
    statements: [CONTENT_OUTBOX_SQL],
  },
  {
    to: "0.3.0",
    name: "001-add-namespace-metadata",
    statements: [NAMESPACE_METADATA_SQL],
  },
  {
    to: "0.4.0",
    name: "001-drop-ns-prefix-columns",
    up: dropNsPrefixColumns,
  },
  {
    to: "0.5.0",
    name: "001-add-memory-suppressed",
    up: async (db) => {
      const cols = await queryAll<{ name: string }>(db.client, `PRAGMA table_info(memories)`);
      if (!cols.some((r) => r.name === "suppressed")) {
        await execSql(
          db.client,
          `ALTER TABLE memories ADD COLUMN suppressed INTEGER NOT NULL DEFAULT 0`,
        );
      }
    },
  },
  {
    to: "0.6.0",
    name: "001-add-namespace-suppressed",
    up: async (db) => {
      const cols = await queryAll<{ name: string }>(
        db.client,
        `PRAGMA table_info(namespace_metadata)`,
      );
      if (!cols.some((r) => r.name === "suppressed")) {
        await execSql(
          db.client,
          `ALTER TABLE namespace_metadata ADD COLUMN suppressed INTEGER NOT NULL DEFAULT 0`,
        );
      }
    },
  },
  {
    to: "0.7.0",
    name: "001-add-content-blobs",
    up: addContentBlobs,
  },
  {
    to: "0.8.0",
    name: "001-add-content-sha256-index",
    statements: [CONTENT_OUTBOX_CONTENT_SHA256_INDEX_SQL],
  },
];

function splitStatements(sql: string): string[] {
  return sql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function flattenMigrationStatements(m: Migration): string[] {
  return (m.statements ?? []).flatMap(splitStatements);
}

export async function listAppliedSchemaVersions(db: LibsqlDatabase): Promise<string[]> {
  try {
    const rows = await queryAll<{ version: string }>(
      db.client,
      `SELECT version FROM _schema_version ORDER BY applied_at ASC`,
    );
    return rows.map((r) => r.version);
  } catch {
    return [];
  }
}

export async function getCurrentSchemaVersion(db: LibsqlDatabase): Promise<string | undefined> {
  const applied = await listAppliedSchemaVersions(db);
  return applied.at(-1);
}

export async function migrateMemoriesLibsql(db: LibsqlDatabase): Promise<void> {
  const applied = new Set(await listAppliedSchemaVersions(db));
  const now = Date.now();

  for (const migration of migrations) {
    if (applied.has(migration.to)) continue;
    if (migration.up) {
      await migration.up(db);
    } else {
      const stmts = flattenMigrationStatements(migration);
      await batchWriteStatements(db.client, stmts);
    }
    await execMultiple(
      db.client,
      `INSERT INTO _schema_version (version, applied_at) VALUES ('${migration.to.replace(/'/g, "''")}', ${now});`,
    );
  }
}

export async function assertSchemaAtLeast(
  db: LibsqlDatabase,
  version = MEMORIES_SCHEMA_VERSION,
): Promise<void> {
  const current = await getCurrentSchemaVersion(db);
  if (current !== version) {
    throw new Error(
      `LibSQL memories schema version mismatch: expected ${version}, found ${current ?? "none"}. Call migrateMemoriesLibsql().`,
    );
  }
}

export async function schemaVersionRowExists(
  db: LibsqlDatabase,
  version: string,
): Promise<boolean> {
  const row = await queryOne<{ version: string }>(
    db.client,
    `SELECT version FROM _schema_version WHERE version = ?`,
    [version],
  );
  return row != null;
}

export { migrations };
