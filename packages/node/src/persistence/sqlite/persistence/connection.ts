import { Database, type DatabaseOptions } from "bun:sqlite";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { openEncryptedDatabaseSync, TEST_SQLCIPHER_KEY } from "@khoralabs/sqlite-crypto";
import { createMigrationRunner } from "@khoralabs/sqlite-migrate";
import * as sqliteVec from "sqlite-vec";
import m001Initial from "./migrations/0.0.0-0.1.0/001-initial";
import m001AddContentOutbox from "./migrations/0.1.0-0.2.0/001-add-content-outbox";
import m001AddNamespaceMetadata from "./migrations/0.2.0-0.3.0/001-add-namespace-metadata";
import m001DropNsPrefixColumns from "./migrations/0.3.0-0.4.0/001-drop-ns-prefix-columns";
import m001AddMemorySuppressed from "./migrations/0.4.0-0.5.0/001-add-memory-suppressed";
import { backfillVectorFeaturesVecTables } from "./search-indexes";

const memoriesMigrations = [
  m001Initial,
  m001AddContentOutbox,
  m001AddNamespaceMetadata,
  m001DropNsPrefixColumns,
  m001AddMemorySuppressed,
];

export function loadSqliteVec(db: Database): void {
  try {
    const fromEnv =
      process.env.SQLITE_VEC_PATH?.trim() || process.env.KHORA_SQLITE_VEC_PATH?.trim();
    if (fromEnv !== undefined && fromEnv.length > 0) {
      db.loadExtension(fromEnv);
    } else {
      sqliteVec.load(db);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/dynamic extension loading|not support.*extension/i.test(msg)) {
      throw new Error(
        `${msg}\n\n` +
          "sqlite-vec requires SQLite built with extension loading. Bun's bundled SQLite often does not support it.\n" +
          "Install Homebrew SQLite and point Bun at it, e.g.:\n" +
          "  brew install sqlite\n" +
          '  export SQLITE_CUSTOM_LIB="$(brew --prefix sqlite)/lib/libsqlite3.dylib"\n' +
          "(macOS). On Linux, install libsqlite3 (distro package) and set SQLITE_CUSTOM_LIB to the\n" +
          "  shared library path if needed (e.g. /usr/lib/x86_64-linux-gnu/libsqlite3.so.0).\n" +
          "Packaged khora-server: set SQLITE_VEC_PATH to the bundled lib/vec0.{dylib,so}.",
      );
    }
    throw e;
  }
}

export type OpenMemoriesDatabaseOptions = DatabaseOptions & {
  /** When set, open with SQLCipher; omit for plaintext Bun SQLite. */
  sqlCipherKey?: string;
};

export const SQLITE_CUSTOM_LIB_ENV = "SQLITE_CUSTOM_LIB";

let didConfigureCustomSqlite = false;
let sqliteVecProbe: boolean | undefined;

/** True when sqlite-vec can load (requires extension-capable libsqlite3 on macOS). */
export function memoriesSqliteVecAvailable(): boolean {
  if (sqliteVecProbe === undefined) {
    try {
      const db = openTestMemoriesDatabase();
      db.close();
      sqliteVecProbe = true;
    } catch {
      sqliteVecProbe = false;
    }
  }
  return sqliteVecProbe;
}

/** Resolve `$(brew --prefix sqlite)/lib/libsqlite3.dylib` when Homebrew sqlite is installed. */
function tryHomebrewSqliteDylibPath(): string | undefined {
  if (process.platform !== "darwin") return undefined;
  try {
    const prefix = execFileSync("brew", ["--prefix", "sqlite"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (prefix.length === 0) return undefined;
    const p = join(prefix, "lib", "libsqlite3.dylib");
    return existsSync(p) ? p : undefined;
  } catch {
    return undefined;
  }
}

export function ensureCustomSqliteForExtensions(): void {
  if (didConfigureCustomSqlite) return;

  const fromEnv = process.env[SQLITE_CUSTOM_LIB_ENV]?.trim();
  const candidates: string[] = [];
  if (fromEnv) candidates.push(fromEnv);

  const brewSqlite = tryHomebrewSqliteDylibPath();
  if (brewSqlite !== undefined) candidates.push(brewSqlite);

  if (process.platform === "darwin") {
    candidates.push(
      "/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib",
      "/usr/local/opt/sqlite/lib/libsqlite3.dylib",
      "/opt/homebrew/opt/sqlite3/lib/libsqlite3.dylib",
      "/usr/local/opt/sqlite3/lib/libsqlite3.dylib",
    );
  }

  if (process.platform === "linux") {
    candidates.push(
      "/usr/lib/x86_64-linux-gnu/libsqlite3.so.0",
      "/usr/lib/x86_64-linux-gnu/libsqlite3.so",
      "/usr/lib/aarch64-linux-gnu/libsqlite3.so.0",
      "/usr/lib/aarch64-linux-gnu/libsqlite3.so",
      "/lib/x86_64-linux-gnu/libsqlite3.so.0",
      "/lib/aarch64-linux-gnu/libsqlite3.so.0",
    );
  }

  for (const p of candidates) {
    if (p.length > 0 && existsSync(p)) {
      try {
        Database.setCustomSQLite(p);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!/SQLite already loaded/i.test(msg)) throw e;
      }
      didConfigureCustomSqlite = true;
      return;
    }
  }

  didConfigureCustomSqlite = true;
}

export type MemoriesSqlitePragmaOptions = {
  /** KiB of page cache, supplied to `PRAGMA cache_size` as a negative value. Default 65536 (~64 MiB). */
  cacheSizeKiB?: number;
  /** Bytes for `PRAGMA mmap_size`. Default 268435456 (256 MiB). Set to 0 to disable. */
  mmapSizeBytes?: number;
  /** ms for `PRAGMA busy_timeout`. Default 5000. */
  busyTimeoutMs?: number;
  /** Pages for `PRAGMA wal_autocheckpoint`. Default 1000 (SQLite default — set explicitly for clarity). */
  walAutocheckpointPages?: number;
};

/**
 * Apply production-tuned SQLite pragmas: WAL + NORMAL sync, busy_timeout, mmap, cache,
 * temp_store=MEMORY, and an explicit wal_autocheckpoint. Idempotent; safe to call on
 * connections that already have these set. Foreign keys are enforced (`memories-core`
 * relies on FK cascades) for parity with previous behavior.
 *
 * Notes on `synchronous = NORMAL`: with WAL journaling this is the documented sweet
 * spot — a crash can lose the most recent committed transaction but cannot corrupt
 * the database. `FULL` only adds one extra `fsync` per commit and is unnecessary here.
 */
export function configureMemoriesSqlitePragmas(
  db: Database,
  opts: MemoriesSqlitePragmaOptions = {},
): void {
  const cacheSizeKiB = opts.cacheSizeKiB ?? 65536;
  const mmapSizeBytes = opts.mmapSizeBytes ?? 268435456;
  const busyTimeoutMs = opts.busyTimeoutMs ?? 5000;
  const walAutocheckpointPages = opts.walAutocheckpointPages ?? 1000;

  db.run("PRAGMA journal_mode = WAL;");
  db.run("PRAGMA synchronous = NORMAL;");
  db.run("PRAGMA foreign_keys = ON;");
  db.run(`PRAGMA busy_timeout = ${busyTimeoutMs};`);
  db.run(`PRAGMA cache_size = -${cacheSizeKiB};`);
  db.run(`PRAGMA mmap_size = ${mmapSizeBytes};`);
  db.run("PRAGMA temp_store = MEMORY;");
  db.run(`PRAGMA wal_autocheckpoint = ${walAutocheckpointPages};`);
}

/**
 * Open a Memories database. Pass `sqlCipherKey` for SQLCipher; omit for plaintext.
 */
export function openMemoriesDatabase(
  filename: string,
  options: OpenMemoriesDatabaseOptions = {},
): Database {
  ensureCustomSqliteForExtensions();
  const { sqlCipherKey, ...dbOptions } = options;
  const db =
    typeof sqlCipherKey === "string" && sqlCipherKey.length > 0
      ? openEncryptedDatabaseSync(filename, { create: true, ...dbOptions }, sqlCipherKey)
      : new Database(filename, { create: true, ...dbOptions });
  configureMemoriesSqlitePragmas(db);
  loadSqliteVec(db);
  initMemoriesSchema(db);
  backfillVectorFeaturesVecTables(db);
  return db;
}

/** Standard test key; use in unit/integration tests only. */
export function openTestMemoriesDatabase(filename = ":memory:"): Database {
  try {
    return openMemoriesDatabase(filename, { sqlCipherKey: TEST_SQLCIPHER_KEY });
  } catch (e) {
    // First open can race: ensureCustomSqlite loads libsqlite before SQLCipher setCustomSQLite.
    const msg = e instanceof Error ? e.message : String(e);
    if (!/SQLite already loaded/i.test(msg)) throw e;
    return openMemoriesDatabase(filename, { sqlCipherKey: TEST_SQLCIPHER_KEY });
  }
}

export function openMemoriesDatabaseReadonly(filename: string): Database {
  ensureCustomSqliteForExtensions();
  const db = new Database(filename, { readonly: true });
  db.run("PRAGMA busy_timeout = 5000;");
  db.run("PRAGMA mmap_size = 268435456;");
  db.run("PRAGMA cache_size = -65536;");
  db.run("PRAGMA temp_store = MEMORY;");
  loadSqliteVec(db);
  return db;
}

export function initMemoriesSchema(db: Database): void {
  configureMemoriesSqlitePragmas(db);
  createMigrationRunner().runSync(db, memoriesMigrations);
}

export function vectorToBlob(vector: Float32Array): Uint8Array {
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
}

export function blobToVector(blob: Uint8Array | Buffer): Float32Array {
  return new Float32Array(
    blob.buffer,
    blob.byteOffset,
    blob.byteLength / Float32Array.BYTES_PER_ELEMENT,
  );
}
