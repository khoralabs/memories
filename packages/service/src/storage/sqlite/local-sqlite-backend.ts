import type { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import type { MemoriesPersistence } from "@khoralabs/memories-node/persistence";
import { wrapSyncMemoriesPersistenceAsAsync } from "@khoralabs/memories-node/persistence";
import {
  createMemoriesPersistence,
  ensureCustomSqliteForExtensions,
  getMemoriesSqliteDatabase,
  openMemoriesDatabase,
} from "@khoralabs/memories-node/sqlite";
import type {
  DatabaseListFilter,
  MemoriesDatabaseBackend,
  MemoriesDatabaseBackendFactory,
  MemoriesDatabaseBackendStrategy,
  MemoriesDatabaseHandle,
  MemoriesDatabaseId,
  SqliteBackendStrategy,
} from "../../storage/core/index";
import {
  createReversibleOwnerKeyEncoder,
  DATABASE_FILENAME,
  OWNER_KEY_ENCODING_VERSION,
  resolveEncodedDatabasePath,
  unsupportedStorageFeature,
  validateMemoriesDatabaseId,
} from "../../storage/core/index";

type OpenedLocalDatabase = {
  persistence: MemoriesPersistence;
  db: Database;
};

function sidecarPaths(dbPath: string): string[] {
  return [`${dbPath}-wal`, `${dbPath}-shm`];
}

function assertSqliteStrategy(strategy: MemoriesDatabaseBackendStrategy): SqliteBackendStrategy {
  if (strategy.kind !== "sqlite") {
    throw new Error(`Expected sqlite strategy, got ${strategy.kind}`);
  }
  if (typeof strategy.dataDir !== "string") {
    throw new Error("sqlite strategy requires dataDir");
  }
  return {
    kind: "sqlite",
    dataDir: strategy.dataDir,
    ...(typeof strategy.sqlCipherKey === "string" ? { sqlCipherKey: strategy.sqlCipherKey } : {}),
  };
}

function openLocalDatabase(
  strategy: SqliteBackendStrategy,
  id: MemoriesDatabaseId,
): OpenedLocalDatabase {
  ensureCustomSqliteForExtensions();
  const filename = resolveEncodedDatabasePath(strategy.dataDir, id);
  mkdirSync(path.dirname(filename), { recursive: true });
  const openOpts =
    typeof strategy.sqlCipherKey === "string" && strategy.sqlCipherKey.length > 0
      ? { sqlCipherKey: strategy.sqlCipherKey }
      : {};
  let db: Database;
  try {
    db = openMemoriesDatabase(filename, openOpts);
  } catch (e) {
    // First open can race: ensureCustomSqlite loads libsqlite before SQLCipher setCustomSQLite.
    const msg = e instanceof Error ? e.message : String(e);
    if (!/SQLite already loaded/i.test(msg)) throw e;
    db = openMemoriesDatabase(filename, openOpts);
  }
  const persistence = createMemoriesPersistence(db);
  return { persistence, db };
}

function createHandle(opened: OpenedLocalDatabase): MemoriesDatabaseHandle {
  let closed = false;
  return {
    persistence: wrapSyncMemoriesPersistenceAsAsync(opened.persistence),
    sync: { syncPersistence: opened.persistence },
    async close() {
      if (closed) return;
      closed = true;
      opened.db.close();
    },
    async checkpoint() {
      if (closed) return;
      getMemoriesSqliteDatabase(opened.persistence).run("PRAGMA wal_checkpoint(TRUNCATE);");
    },
  };
}

export type CreateLocalSqliteBackendOptions = {
  strategy: SqliteBackendStrategy;
};

export function createLocalSqliteBackend(
  opts: CreateLocalSqliteBackendOptions,
): MemoriesDatabaseBackend {
  const validatedStrategy = assertSqliteStrategy(opts.strategy);
  const encoder = createReversibleOwnerKeyEncoder();
  let extensionsReady = false;

  function ensureExtensions(): void {
    if (extensionsReady) return;
    ensureCustomSqliteForExtensions();
    mkdirSync(validatedStrategy.dataDir, { recursive: true });
    extensionsReady = true;
  }

  function dbPath(id: MemoriesDatabaseId): string {
    return resolveEncodedDatabasePath(validatedStrategy.dataDir, id, encoder);
  }

  return {
    strategy: validatedStrategy,

    async open(id) {
      return createHandle(openLocalDatabase(validatedStrategy, id));
    },

    async exists(id) {
      return existsSync(dbPath(validateMemoriesDatabaseId(id)));
    },

    async list(filter?: DatabaseListFilter) {
      ensureExtensions();
      const versionDir = path.join(validatedStrategy.dataDir, OWNER_KEY_ENCODING_VERSION);
      if (!existsSync(versionDir)) return [];

      const ids: MemoriesDatabaseId[] = [];
      for (const encodedEntry of readdirSync(versionDir, { withFileTypes: true })) {
        if (!encodedEntry.isDirectory()) continue;
        let decoded: MemoriesDatabaseId;
        try {
          decoded = encoder.decodeDatabaseId(encodedEntry.name);
        } catch {
          continue;
        }
        if (filter?.kind !== undefined && decoded.kind !== filter.kind) continue;
        const filePath = path.join(versionDir, encodedEntry.name, DATABASE_FILENAME);
        if (!existsSync(filePath)) continue;
        ids.push(decoded);
      }
      return ids;
    },

    async delete(id) {
      const validated = validateMemoriesDatabaseId(id);
      const file = dbPath(validated);
      const dir = path.dirname(file);
      if (existsSync(file)) rmSync(file, { force: true });
      for (const sidecar of sidecarPaths(file)) {
        if (existsSync(sidecar)) rmSync(sidecar, { force: true });
      }
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    },

    async checkpoint(id) {
      const opened = openLocalDatabase(validatedStrategy, id);
      try {
        getMemoriesSqliteDatabase(opened.persistence).run("PRAGMA wal_checkpoint(TRUNCATE);");
      } finally {
        opened.db.close();
      }
    },

    async snapshot(_id) {
      return unsupportedStorageFeature("snapshot", "sqlite");
    },

    async close(_id) {
      return;
    },
  };
}

export function createLocalSqliteBackendFactory(): MemoriesDatabaseBackendFactory {
  return {
    create(strategy) {
      return createLocalSqliteBackend({ strategy: assertSqliteStrategy(strategy) });
    },
  };
}

export { resolveEncodedDatabasePath as resolveLocalSqliteDatabasePath };
