import { execMultiple, queryAll, queryOne } from "./client";
import type { TursoDatabase } from "./db";
import {
  CONTENT_OUTBOX_SQL,
  MEMORIES_INDEXES_SQL,
  MEMORIES_SCHEMA_SQL,
  NAMESPACE_METADATA_SQL,
} from "./schema";
import { batchWriteStatements } from "./transactions";
import {
  SCHEMA_VERSION_TABLE_SQL,
  TEXT_FEATURES_FTS_INDEX_SQL,
  TURSO_PRAGMAS_SQL,
} from "./turso-schema";

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
      TURSO_PRAGMAS_SQL,
      SCHEMA_VERSION_TABLE_SQL,
      MEMORIES_SCHEMA_SQL,
      MEMORIES_INDEXES_SQL,
      TEXT_FEATURES_FTS_INDEX_SQL,
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

export async function listAppliedSchemaVersions(db: TursoDatabase): Promise<string[]> {
  try {
    const rows = await queryAll<{ version: string }>(
      db.read,
      `SELECT version FROM _schema_version ORDER BY applied_at ASC`,
    );
    return rows.map((r) => r.version);
  } catch {
    return [];
  }
}

export async function getCurrentSchemaVersion(db: TursoDatabase): Promise<string | undefined> {
  const applied = await listAppliedSchemaVersions(db);
  return applied.at(-1);
}

export async function migrateMemoriesTursoServerless(db: TursoDatabase): Promise<void> {
  const applied = new Set(await listAppliedSchemaVersions(db));
  const now = Date.now();

  for (const migration of migrations) {
    if (applied.has(migration.to)) continue;
    const stmts = flattenMigrationStatements(migration);
    await batchWriteStatements(db.batch, stmts);
    await execMultiple(
      db.write,
      `INSERT INTO _schema_version (version, applied_at) VALUES ('${migration.to.replace(/'/g, "''")}', ${now});`,
    );
  }
}

export async function assertSchemaAtLeast(
  db: TursoDatabase,
  version = MEMORIES_SCHEMA_VERSION,
): Promise<void> {
  const current = await getCurrentSchemaVersion(db);
  if (current !== version) {
    throw new Error(
      `Turso memories schema version mismatch: expected ${version}, found ${current ?? "none"}. Call migrateMemoriesTursoServerless().`,
    );
  }
}

export async function schemaVersionRowExists(db: TursoDatabase, version: string): Promise<boolean> {
  const row = await queryOne<{ version: string }>(
    db.read,
    `SELECT version FROM _schema_version WHERE version = ?`,
    [version],
  );
  return row != null;
}

export { migrations };
