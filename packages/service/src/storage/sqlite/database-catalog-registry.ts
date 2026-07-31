import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { openEncryptedDatabaseSync } from "@khoralabs/sqlite-crypto";
import type {
  MemoriesDatabaseCatalogEntry,
  MemoriesDatabaseCatalogStore,
  MemoriesDatabaseMetadata,
} from "../../storage/core/database-catalog";
import type { DatabaseListFilter, MemoriesDatabaseId } from "../../storage/core/index";
import { validateMemoriesDatabaseId } from "../../storage/core/index";

const CATALOG_SCHEMA = `
CREATE TABLE IF NOT EXISTS database_catalog (
  kind TEXT NOT NULL,
  owner_key TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (kind, owner_key)
);
`;

function openRegistryDatabase(registryPath: string, sqlCipherKey?: string): Database {
  return typeof sqlCipherKey === "string" && sqlCipherKey.length > 0
    ? openEncryptedDatabaseSync(registryPath, { create: true }, sqlCipherKey)
    : new Database(registryPath, { create: true });
}

export type SqliteDatabaseCatalogStoreOptions = {
  registryPath: string;
  sqlCipherKey?: string;
};

export function createSqliteDatabaseCatalogStore(
  opts: SqliteDatabaseCatalogStoreOptions,
): MemoriesDatabaseCatalogStore {
  mkdirSync(path.dirname(opts.registryPath), { recursive: true });
  const db = openRegistryDatabase(opts.registryPath, opts.sqlCipherKey);
  db.run("PRAGMA journal_mode = WAL;");
  db.run("PRAGMA foreign_keys = ON;");
  db.exec(CATALOG_SCHEMA);

  const selectOne = db.prepare(
    `SELECT name, description FROM database_catalog WHERE kind = ? AND owner_key = ?`,
  );
  const upsertStmt = db.prepare(`
    INSERT INTO database_catalog (kind, owner_key, name, description, updated_at_ms)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(kind, owner_key) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      updated_at_ms = excluded.updated_at_ms
  `);
  const deleteStmt = db.prepare(`DELETE FROM database_catalog WHERE kind = ? AND owner_key = ?`);
  const listStmt = db.prepare(
    `SELECT kind, owner_key, name, description, updated_at_ms FROM database_catalog`,
  );

  return {
    async get(id) {
      const validated = validateMemoriesDatabaseId(id);
      const row = selectOne.get(validated.kind, validated.ownerKey) as {
        name: string;
        description: string;
      } | null;
      return row ?? undefined;
    },
    async upsert(id, patch) {
      const validated = validateMemoriesDatabaseId(id);
      const existing = selectOne.get(validated.kind, validated.ownerKey) as {
        name: string;
        description: string;
      } | null;
      const name = patch.name !== undefined ? patch.name : (existing?.name ?? "");
      const description =
        patch.description !== undefined ? patch.description : (existing?.description ?? "");
      const updatedAtMs = Date.now();
      upsertStmt.run(validated.kind, validated.ownerKey, name, description, updatedAtMs);
      return { name, description } satisfies MemoriesDatabaseMetadata;
    },
    async remove(id) {
      const validated = validateMemoriesDatabaseId(id);
      deleteStmt.run(validated.kind, validated.ownerKey);
    },
    async list(filter?: DatabaseListFilter) {
      const rows = listStmt.all() as Array<{
        kind: string;
        owner_key: string;
        name: string;
        description: string;
        updated_at_ms: number;
      }>;
      const out: MemoriesDatabaseCatalogEntry[] = [];
      for (const row of rows) {
        const id: MemoriesDatabaseId = { kind: row.kind, ownerKey: row.owner_key };
        if (filter?.kind !== undefined && id.kind !== filter.kind) continue;
        out.push({
          id,
          name: row.name,
          description: row.description,
          updatedAtMs: row.updated_at_ms,
        });
      }
      return out;
    },
  };
}

export function openDatabaseCatalogRegistryDb(
  registryPath: string,
  sqlCipherKey?: string,
): Database {
  mkdirSync(path.dirname(registryPath), { recursive: true });
  const db = openRegistryDatabase(registryPath, sqlCipherKey);
  db.run("PRAGMA journal_mode = WAL;");
  db.run("PRAGMA foreign_keys = ON;");
  db.exec(CATALOG_SCHEMA);
  return db;
}
