import type {
  MemoriesBackendCapabilities,
  MemoriesPersistence,
  MemoriesPersistenceAsync,
} from "@khoralabs/memories-node/persistence";
import {
  DEFAULT_MEMORIES_BACKEND_CAPABILITIES,
  resolveMemoriesBackendCapabilities,
} from "@khoralabs/memories-node/persistence";
import type { MemoriesTelemetry } from "@khoralabs/memories-node/telemetry";

import type { DatabaseListFilter, MemoriesDatabaseId } from "./database-id";
import type { MemoriesDatabaseSnapshot } from "./snapshot";

/** Partial overrides; same contract as {@link MemoriesPersistence.capabilities}. */
export type StrategyCapabilities = Partial<MemoriesBackendCapabilities>;

/** Capabilities of the local SQLCipher file backend (`@khoralabs/memories-node/sqlite`). */
export const DEFAULT_SQLITE_STRATEGY_CAPABILITIES: MemoriesBackendCapabilities = {
  lexicalSearch: true,
  vectorSearch: true,
  vectorKnnSearch: true,
  vectorAnnSearch: true,
  neighborIndex: true,
  graphIndex: true,
  multiNamespaceSearch: true,
  unscopedSearch: true,
  asOfTimestampMsSearch: true,
};

/** Capabilities of the Turso serverless backend (`@khoralabs/memories-node/turso-serverless`). */
export const DEFAULT_TURSO_SERVERLESS_STRATEGY_CAPABILITIES: MemoriesBackendCapabilities = {
  lexicalSearch: true,
  vectorSearch: true,
  vectorKnnSearch: true,
  vectorAnnSearch: false,
  neighborIndex: true,
  graphIndex: true,
  multiNamespaceSearch: true,
  unscopedSearch: true,
  asOfTimestampMsSearch: true,
};

/** Capabilities of the local libSQL file backend (`@khoralabs/memories-node/libsql`). */
export const DEFAULT_LIBSQL_STRATEGY_CAPABILITIES: MemoriesBackendCapabilities = {
  lexicalSearch: true,
  vectorSearch: true,
  vectorKnnSearch: true,
  vectorAnnSearch: true,
  neighborIndex: true,
  graphIndex: true,
  multiNamespaceSearch: true,
  unscopedSearch: true,
  asOfTimestampMsSearch: true,
};

export type SqliteBackendStrategy = {
  kind: "sqlite";
  dataDir: string;
  sqlCipherKey?: string;
  capabilities?: StrategyCapabilities;
};

/** Remote Turso Cloud database accessed via `@tursodatabase/serverless`. */
export type TursoServerlessBackendStrategy = {
  kind: "turso-serverless";
  /** Turso database URL. Supports `{ownerKey}` and `{kind}` placeholders for per-principal databases. */
  url: string;
  authToken?: string;
  remoteEncryptionKey?: string;
  capabilities?: StrategyCapabilities;
};

/** Local multi-tenant libSQL files under `dataDir` (encoded paths), optional at-rest encryption. */
export type LibsqlBackendStrategy = {
  kind: "libsql";
  dataDir: string;
  /** Optional at-rest key for local `file:` DBs (maps to memories-libsql `encryptionKey`). */
  encryptionKey?: string;
  capabilities?: StrategyCapabilities;
};

export type MemoriesDatabaseBackendStrategy =
  | SqliteBackendStrategy
  | TursoServerlessBackendStrategy
  | LibsqlBackendStrategy
  | ({ kind: string; capabilities?: StrategyCapabilities } & Record<string, unknown>);

export function resolveStrategyCapabilities(
  strategy: MemoriesDatabaseBackendStrategy,
): MemoriesBackendCapabilities {
  const partial = strategy.capabilities;
  if (strategy.kind === "sqlite") {
    return { ...DEFAULT_SQLITE_STRATEGY_CAPABILITIES, ...partial };
  }
  if (strategy.kind === "turso-serverless") {
    return { ...DEFAULT_TURSO_SERVERLESS_STRATEGY_CAPABILITIES, ...partial };
  }
  if (strategy.kind === "libsql") {
    return { ...DEFAULT_LIBSQL_STRATEGY_CAPABILITIES, ...partial };
  }
  return resolveMemoriesBackendCapabilities({ capabilities: partial });
}

/**
 * Optional sync persistence bag on an open handle.
 * Present for local SQLite (and any backend that exposes sync mutations).
 * Intentionally Bun-free — raw SQLite Database handles stay in `./storage/sqlite`.
 */
export type SyncPersistenceContext = {
  syncPersistence: MemoriesPersistence;
};

export type MemoriesDatabaseHandle = {
  persistence: MemoriesPersistenceAsync;
  close(): Promise<void>;
  checkpoint?(): Promise<void>;
  /** Present when the backend exposes sync `MemoriesPersistence` (e.g. local SQLite). */
  sync?: SyncPersistenceContext;
  /**
   * Optional structured telemetry bound by the service (includes `memories.database.*` attrs).
   * Not set by storage backends — attached in {@link createMemoriesDatabaseService}.
   */
  telemetry?: MemoriesTelemetry;
};

export type MemoriesDatabaseBackend = {
  readonly strategy: MemoriesDatabaseBackendStrategy;
  open(id: MemoriesDatabaseId): Promise<MemoriesDatabaseHandle>;
  exists(id: MemoriesDatabaseId): Promise<boolean>;
  list(filter?: DatabaseListFilter): Promise<MemoriesDatabaseId[]>;
  delete(id: MemoriesDatabaseId): Promise<void>;
  checkpoint(id: MemoriesDatabaseId): Promise<void>;
  snapshot(id: MemoriesDatabaseId): Promise<MemoriesDatabaseSnapshot>;
  close(id: MemoriesDatabaseId): Promise<void>;
};

export type MemoriesDatabaseBackendFactory = {
  create(strategy: MemoriesDatabaseBackendStrategy): MemoriesDatabaseBackend;
};

export function strategyCacheKey(strategy: MemoriesDatabaseBackendStrategy): string {
  return JSON.stringify(strategy);
}

export type { MemoriesBackendCapabilities };
export { DEFAULT_MEMORIES_BACKEND_CAPABILITIES };
