import type { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import type { MemoriesPersistence } from "@khoralabs/memories-core/persistence";
import { wrapSyncMemoriesPersistenceAsAsync } from "@khoralabs/memories-core/persistence";
import type {
  DatabaseListFilter,
  MemoriesDatabaseBackend,
  MemoriesDatabaseBackendFactory,
  MemoriesDatabaseBackendStrategy,
  MemoriesDatabaseHandle,
  MemoriesDatabaseId,
  SqliteBackendStrategy,
} from "@khoralabs/memories-service";
import {
  createReversibleOwnerKeyEncoder,
  OWNER_KEY_ENCODING_VERSION,
  resolveEncodedDatabasePath,
  validateDatabaseKind,
  validateMemoriesDatabaseId,
} from "@khoralabs/memories-service";
import {
  createMemoriesPersistence,
  ensureCustomSqliteForExtensions,
  getMemoriesSqliteDatabase,
  openMemoriesDatabase,
} from "@khoralabs/memories-sqlite";

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
  if (strategy.sqlCipherKey === undefined) {
    throw new Error("sqlite strategy requires sqlCipherKey to open databases");
  }
  ensureCustomSqliteForExtensions();
  const filename = resolveEncodedDatabasePath(strategy.dataDir, id);
  mkdirSync(path.dirname(filename), { recursive: true });
  const db = openMemoriesDatabase(filename, { sqlCipherKey: strategy.sqlCipherKey });
  const persistence = createMemoriesPersistence(db);
  return { persistence, db };
}

function createHandle(opened: OpenedLocalDatabase): MemoriesDatabaseHandle {
  let closed = false;
  return {
    persistence: wrapSyncMemoriesPersistenceAsAsync(opened.persistence),
    sqlite: { db: opened.db, syncPersistence: opened.persistence },
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

export function createLocalSqliteBackend(strategy: SqliteBackendStrategy): MemoriesDatabaseBackend {
  const validatedStrategy = assertSqliteStrategy(strategy);
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

      const kinds = filter?.kind
        ? [validateDatabaseKind(filter.kind)]
        : readdirSync(versionDir, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name);

      const ids: MemoriesDatabaseId[] = [];
      for (const kind of kinds) {
        const kindDir = path.join(versionDir, kind);
        if (!existsSync(kindDir)) continue;
        for (const encodedEntry of readdirSync(kindDir, { withFileTypes: true })) {
          if (!encodedEntry.isDirectory()) continue;
          const filePath = path.join(kindDir, encodedEntry.name, `${encodedEntry.name}.db`);
          if (!existsSync(filePath)) continue;
          ids.push({
            kind,
            ownerKey: encoder.decodeOwnerKey(encodedEntry.name),
          });
        }
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

    async close(_id) {
      return;
    },
  };
}

export function createLocalSqliteBackendFactory(): MemoriesDatabaseBackendFactory {
  return {
    create(strategy) {
      return createLocalSqliteBackend(assertSqliteStrategy(strategy));
    },
  };
}

export { resolveEncodedDatabasePath as resolveLocalSqliteDatabasePath };
