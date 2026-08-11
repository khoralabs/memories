import type { Database } from "bun:sqlite";
import type { LabelPropsSearchFormatter, NamespacePathPolicy } from "../../../persistence/core";
import type { MemoriesPersistenceAsync } from "../../../persistence/core/persistence";
import type { ContentBlobColdStore } from "../../../persistence/core/persistence/content-blob-cold-store";
import type { BunS3ContentBlobColdStoreOptions } from "./content-blob-cold-store-bun";
import {
  createMemoriesPersistence,
  type MemoriesPersistence as IMemoriesPersistence,
  MemoriesPersistence,
} from "./persistence";

type SqliteAsyncBacking = {
  sync: IMemoriesPersistence;
  db: Database;
};

const sqliteAsyncBacking = new WeakMap<object, SqliteAsyncBacking>();

function attachSqliteAsyncBacking(
  persistence: MemoriesPersistenceAsync,
  backing: SqliteAsyncBacking,
): MemoriesPersistenceAsync {
  sqliteAsyncBacking.set(persistence, backing);
  return persistence;
}

/**
 * Wrap sync {@link MemoriesPersistence} as {@link MemoriesPersistenceAsync}.
 * Uses manual BEGIN/COMMIT so async merge/search paths can await inside a transaction.
 */
export function wrapMemoriesPersistenceAsAsync(
  sync: IMemoriesPersistence,
  db: Database,
): MemoriesPersistenceAsync {
  let inTransaction = false;

  const proxy = new Proxy(sync, {
    get(target, prop, receiver) {
      if (prop === "capabilities") {
        return Reflect.get(target, "capabilities", receiver);
      }
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") {
        return value;
      }
      if (prop === "withTransaction") {
        return async <T>(fn: () => Promise<T>): Promise<T> => {
          if (inTransaction) {
            return fn();
          }
          inTransaction = true;
          db.run("BEGIN IMMEDIATE");
          try {
            const result = await fn();
            db.run("COMMIT");
            return result;
          } catch (err) {
            try {
              db.run("ROLLBACK");
            } catch {
              /* ignore rollback failure */
            }
            throw err;
          } finally {
            inTransaction = false;
          }
        };
      }
      return (...args: unknown[]) =>
        Promise.resolve((value as (...a: unknown[]) => unknown).apply(target, args));
    },
  }) as unknown as MemoriesPersistenceAsync;

  return attachSqliteAsyncBacking(proxy, { sync, db });
}

export function createMemoriesPersistenceAsync(
  db: Database,
  options?: {
    labelPropsSearchFormatter?: LabelPropsSearchFormatter;
    namespacePathPolicy?: NamespacePathPolicy;
    contentOutboxRetentionTips?: number;
    contentBlobColdStore?: ContentBlobColdStore;
    bunS3ColdStore?: BunS3ContentBlobColdStoreOptions | false;
  },
): MemoriesPersistenceAsync {
  const sync = createMemoriesPersistence(db, options);
  return wrapMemoriesPersistenceAsAsync(sync, db);
}

function resolveSqliteAsyncBacking(
  persistence: MemoriesPersistenceAsync,
): SqliteAsyncBacking | undefined {
  if (sqliteAsyncBacking.has(persistence)) {
    return sqliteAsyncBacking.get(persistence);
  }
  if (persistence instanceof MemoriesPersistence) {
    return { sync: persistence, db: persistence.getDatabase() };
  }
  return undefined;
}

/** Resolve the SQLite `Database` from an async adapter backed by sync persistence. */
export function getMemoriesSqliteDatabaseFromAsync(
  persistence: MemoriesPersistenceAsync,
): Database {
  const backing = resolveSqliteAsyncBacking(persistence);
  if (backing !== undefined) {
    return backing.db;
  }
  throw new Error(
    "getMemoriesSqliteDatabaseFromAsync: expected SQLite-backed MemoriesPersistenceAsync",
  );
}

/** Resolve sync persistence from a SQLite async adapter (admin projections, sync unwrap). */
export function getMemoriesSyncPersistenceFromAsync(
  persistence: MemoriesPersistenceAsync,
): IMemoriesPersistence {
  const backing = resolveSqliteAsyncBacking(persistence);
  if (backing !== undefined) {
    return backing.sync;
  }
  throw new Error(
    "getMemoriesSyncPersistenceFromAsync: expected SQLite-backed MemoriesPersistenceAsync",
  );
}
