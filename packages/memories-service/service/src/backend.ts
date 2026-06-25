import type { Database } from "bun:sqlite";
import type {
  MemoriesBackendCapabilities,
  MemoriesPersistence,
  MemoriesPersistenceAsync,
} from "@khoralabs/memories-core/persistence";
import {
  DEFAULT_MEMORIES_BACKEND_CAPABILITIES,
  resolveMemoriesBackendCapabilities,
} from "@khoralabs/memories-core/persistence";

import type { DatabaseListFilter, MemoriesDatabaseId } from "./types";

/** Partial overrides; same contract as {@link MemoriesPersistence.capabilities}. */
export type StrategyCapabilities = Partial<MemoriesBackendCapabilities>;

/** Capabilities of the local SQLCipher file backend (`@khoralabs/memories-sqlite`). */
export const DEFAULT_SQLITE_STRATEGY_CAPABILITIES: MemoriesBackendCapabilities = {
  lexicalSearch: true,
  vectorSearch: true,
  neighborIndex: true,
  graphIndex: true,
  multiNamespaceSearch: true,
  unscopedSearch: true,
  asOfTimestampMsSearch: true,
};

/** Capabilities of the Turso serverless backend (`@khoralabs/memories-turso-serverless`). */
export const DEFAULT_TURSO_SERVERLESS_STRATEGY_CAPABILITIES: MemoriesBackendCapabilities = {
  lexicalSearch: true,
  vectorSearch: true,
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

export type MemoriesDatabaseBackendStrategy =
  | SqliteBackendStrategy
  | TursoServerlessBackendStrategy
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
  return resolveMemoriesBackendCapabilities({ capabilities: partial });
}

export type SqliteDatabaseContext = {
  db: Database;
  syncPersistence: MemoriesPersistence;
};

export type MemoriesDatabaseHandle = {
  persistence: MemoriesPersistenceAsync;
  close(): Promise<void>;
  checkpoint?(): Promise<void>;
  /** Present for SQLite backends; required for graph reads and sync mutations. */
  sqlite?: SqliteDatabaseContext;
};

export type MemoriesDatabaseBackend = {
  readonly strategy: MemoriesDatabaseBackendStrategy;
  open(id: MemoriesDatabaseId): Promise<MemoriesDatabaseHandle>;
  exists(id: MemoriesDatabaseId): Promise<boolean>;
  list(filter?: DatabaseListFilter): Promise<MemoriesDatabaseId[]>;
  delete(id: MemoriesDatabaseId): Promise<void>;
  checkpoint(id: MemoriesDatabaseId): Promise<void>;
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
