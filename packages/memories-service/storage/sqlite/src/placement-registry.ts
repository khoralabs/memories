import type { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type {
  MemoriesDatabaseBackendStrategy,
  MemoriesDatabasePlacementStore,
} from "@khoralabs/memories-service-storage-core";
import {
  parseStrategy,
  serializeStrategy,
  validateMemoriesDatabaseId,
} from "@khoralabs/memories-service-storage-core";
import { openEncryptedDatabaseSync } from "@khoralabs/sqlite-crypto";

const PLACEMENT_SCHEMA = `
CREATE TABLE IF NOT EXISTS placement_defaults (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  strategy_kind TEXT NOT NULL,
  strategy_json TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS placement_overrides (
  kind TEXT NOT NULL,
  owner_key TEXT NOT NULL,
  strategy_kind TEXT NOT NULL,
  strategy_json TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (kind, owner_key)
);
`;

export type SqlitePlacementStoreOptions = {
  registryPath: string;
  sqlCipherKey: string;
  defaultStrategy: MemoriesDatabaseBackendStrategy;
};

export function createSqlitePlacementStore(
  opts: SqlitePlacementStoreOptions,
): MemoriesDatabasePlacementStore {
  mkdirSync(path.dirname(opts.registryPath), { recursive: true });
  const db = openEncryptedDatabaseSync(opts.registryPath, { create: true }, opts.sqlCipherKey);
  db.run("PRAGMA journal_mode = WAL;");
  db.run("PRAGMA foreign_keys = ON;");
  db.exec(PLACEMENT_SCHEMA);

  const now = () => Date.now();
  const upsertDefault = db.prepare(`
    INSERT INTO placement_defaults (singleton_id, strategy_kind, strategy_json, updated_at_ms)
    VALUES (1, ?, ?, ?)
    ON CONFLICT(singleton_id) DO UPDATE SET
      strategy_kind = excluded.strategy_kind,
      strategy_json = excluded.strategy_json,
      updated_at_ms = excluded.updated_at_ms
  `);
  const selectDefault = db.prepare(`
    SELECT strategy_json FROM placement_defaults WHERE singleton_id = 1
  `);
  const upsertOverride = db.prepare(`
    INSERT INTO placement_overrides (kind, owner_key, strategy_kind, strategy_json, updated_at_ms)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(kind, owner_key) DO UPDATE SET
      strategy_kind = excluded.strategy_kind,
      strategy_json = excluded.strategy_json,
      updated_at_ms = excluded.updated_at_ms
  `);
  const selectOverride = db.prepare(`
    SELECT strategy_json FROM placement_overrides WHERE kind = ? AND owner_key = ?
  `);
  const deleteOverride = db.prepare(`
    DELETE FROM placement_overrides WHERE kind = ? AND owner_key = ?
  `);
  const listOverridesStmt = db.prepare(`
    SELECT kind, owner_key, strategy_json FROM placement_overrides
  `);

  const seeded = selectDefault.get() as { strategy_json: string } | null;
  if (seeded == null) {
    const initial = serializeStrategy(opts.defaultStrategy);
    upsertDefault.run(initial.kind, initial.json, now());
  }

  return {
    async getDefaultStrategy() {
      const row = selectDefault.get() as { strategy_json: string } | null;
      if (row == null) return opts.defaultStrategy;
      return parseStrategy(row.strategy_json);
    },
    async setDefaultStrategy(strategy) {
      const serialized = serializeStrategy(strategy);
      upsertDefault.run(serialized.kind, serialized.json, now());
    },
    async getStrategy(id) {
      const validated = validateMemoriesDatabaseId(id);
      const row = selectOverride.get(validated.kind, validated.ownerKey) as {
        strategy_json: string;
      } | null;
      if (row == null) return undefined;
      return parseStrategy(row.strategy_json);
    },
    async setStrategy(id, strategy) {
      const validated = validateMemoriesDatabaseId(id);
      const serialized = serializeStrategy(strategy);
      upsertOverride.run(
        validated.kind,
        validated.ownerKey,
        serialized.kind,
        serialized.json,
        now(),
      );
    },
    async removeStrategy(id) {
      const validated = validateMemoriesDatabaseId(id);
      deleteOverride.run(validated.kind, validated.ownerKey);
    },
    async listOverrides(filter) {
      const rows = listOverridesStmt.all() as Array<{
        kind: string;
        owner_key: string;
        strategy_json: string;
      }>;
      return rows
        .filter((row) => filter?.kind === undefined || row.kind === filter.kind)
        .map((row) => ({
          id: { kind: row.kind, ownerKey: row.owner_key },
          strategy: parseStrategy(row.strategy_json),
        }));
    },
  };
}

export function openPlacementRegistryDb(registryPath: string, sqlCipherKey: string): Database {
  mkdirSync(path.dirname(registryPath), { recursive: true });
  const db = openEncryptedDatabaseSync(registryPath, { create: true }, sqlCipherKey);
  db.exec(PLACEMENT_SCHEMA);
  return db;
}
