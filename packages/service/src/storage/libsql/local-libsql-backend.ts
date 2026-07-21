import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  createLibsqlDatabase,
  createMemoriesLibsqlPersistence,
  type LibsqlDatabase,
} from "@khoralabs/memories-node/libsql";
import type {
  DatabaseListFilter,
  LibsqlBackendStrategy,
  MemoriesDatabaseBackend,
  MemoriesDatabaseBackendFactory,
  MemoriesDatabaseBackendStrategy,
  MemoriesDatabaseHandle,
  MemoriesDatabaseId,
} from "../../storage-core/index";
import {
  createReversibleOwnerKeyEncoder,
  DATABASE_FILENAME,
  OWNER_KEY_ENCODING_VERSION,
  resolveEncodedDatabasePath,
  unsupportedStorageFeature,
  validateMemoriesDatabaseId,
} from "../../storage-core/index";

function sidecarPaths(dbPath: string): string[] {
  return [`${dbPath}-wal`, `${dbPath}-shm`];
}

function assertLibsqlStrategy(strategy: MemoriesDatabaseBackendStrategy): LibsqlBackendStrategy {
  if (strategy.kind !== "libsql") {
    throw new Error(`Expected libsql strategy, got ${strategy.kind}`);
  }
  if (typeof strategy.dataDir !== "string") {
    throw new Error("libsql strategy requires dataDir");
  }
  return {
    kind: "libsql",
    dataDir: strategy.dataDir,
    ...(typeof strategy.encryptionKey === "string"
      ? { encryptionKey: strategy.encryptionKey }
      : {}),
  };
}

function fileUrlForPath(absPath: string): string {
  return pathToFileURL(path.resolve(absPath)).href;
}

async function openLocalDatabase(
  strategy: LibsqlBackendStrategy,
  id: MemoriesDatabaseId,
): Promise<{ db: LibsqlDatabase; handle: MemoriesDatabaseHandle }> {
  const filename = resolveEncodedDatabasePath(strategy.dataDir, id);
  mkdirSync(path.dirname(filename), { recursive: true });
  const db = createLibsqlDatabase({
    url: fileUrlForPath(filename),
    ...(strategy.encryptionKey !== undefined ? { encryptionKey: strategy.encryptionKey } : {}),
  });
  const persistence = await createMemoriesLibsqlPersistence({ db, autoMigrate: true });
  let closed = false;
  const handle: MemoriesDatabaseHandle = {
    persistence,
    async close() {
      if (closed) return;
      closed = true;
      db.client.close();
    },
  };
  return { db, handle };
}

export type CreateLocalLibsqlBackendOptions = {
  strategy: LibsqlBackendStrategy;
};

export function createLocalLibsqlBackend(
  opts: CreateLocalLibsqlBackendOptions,
): MemoriesDatabaseBackend {
  const validatedStrategy = assertLibsqlStrategy(opts.strategy);
  const encoder = createReversibleOwnerKeyEncoder();

  function ensureDataDir(): void {
    mkdirSync(validatedStrategy.dataDir, { recursive: true });
  }

  function dbPath(id: MemoriesDatabaseId): string {
    return resolveEncodedDatabasePath(validatedStrategy.dataDir, id, encoder);
  }

  return {
    strategy: validatedStrategy,

    async open(id) {
      const { handle } = await openLocalDatabase(validatedStrategy, id);
      return handle;
    },

    async exists(id) {
      return existsSync(dbPath(validateMemoriesDatabaseId(id)));
    },

    async list(filter?: DatabaseListFilter) {
      ensureDataDir();
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

    async checkpoint(_id) {
      // Local libSQL may use WAL sidecars; no dedicated checkpoint API required by contract.
    },

    async snapshot(_id) {
      return unsupportedStorageFeature("snapshot", "libsql");
    },

    async close(_id) {
      return;
    },
  };
}

export function createLocalLibsqlBackendFactory(): MemoriesDatabaseBackendFactory {
  return {
    create(strategy) {
      return createLocalLibsqlBackend({ strategy: assertLibsqlStrategy(strategy) });
    },
  };
}

export { resolveEncodedDatabasePath as resolveLocalLibsqlDatabasePath };
