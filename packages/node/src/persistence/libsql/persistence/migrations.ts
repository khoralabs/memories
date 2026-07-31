import type { LibsqlDatabase } from "./client";
import { execMultiple, queryAll, queryOne } from "./client";
import {
  LIBSQL_PRAGMAS_SQL,
  SCHEMA_VERSION_TABLE_SQL,
  TEXT_FEATURES_FTS_SQL,
} from "./libsql-schema";
import {
  CONTENT_OUTBOX_SQL,
  MEMORIES_INDEXES_SQL,
  MEMORIES_SCHEMA_SQL,
  NAMESPACE_METADATA_SQL,
} from "./schema";
import { batchWriteStatements } from "./transactions";

export const MEMORIES_SCHEMA_VERSION = "0.3.0";

type Migration = {
  to: string;
  name: string;
  statements: string[];
};

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
];

function splitStatements(sql: string): string[] {
  return sql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function flattenMigrationStatements(m: Migration): string[] {
  return m.statements.flatMap(splitStatements);
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
    const stmts = flattenMigrationStatements(migration);
    await batchWriteStatements(db.client, stmts);
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
