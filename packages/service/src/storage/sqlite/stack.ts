import path from "node:path";
import { ensureCustomSqliteForExtensions } from "@khoralabs/memories-node/sqlite";
import type { MemoriesTelemetry } from "@khoralabs/memories-node/telemetry";
import {
  createBackendResolver,
  createCompositeBackendFactory,
  createMemoriesDatabaseService,
  type MemoriesDatabaseService,
} from "../../service/index";
import type {
  MemoriesDatabaseBackendFactory,
  MemoriesDatabaseCatalogStore,
  MemoriesDatabaseOntologyStore,
  MemoriesDatabasePlacementStore,
  SqliteBackendStrategy,
} from "../../storage/core/index";
import { createSqliteDatabaseCatalogStore } from "./database-catalog-registry";
import { createLocalSqliteBackendFactory } from "./local-sqlite-backend";
import { createSqliteOntologyStore } from "./ontology-registry";
import { createSqlitePlacementStore } from "./placement-registry";

export type CreateLocalSqliteServiceStackOptions = {
  dataDir: string;
  /** When set, encrypt node DBs and registries with SQLCipher; omit for plaintext. */
  sqlCipherKey?: string;
  registryPath?: string;
  ontologyRegistryPath?: string;
  databaseCatalogRegistryPath?: string;
  /**
   * Override the node backend factory; defaults to **sqlite only**.
   *
   * Do not statically import `./storage/libsql` or `./storage/turso-serverless` from hosts that
   * `bun build --compile` — `@libsql/client` native bindings are not embeddable. Pass an explicit
   * {@link createCompositeBackendFactory} that includes those factories only when the runtime has
   * `node_modules` (or you have staged the platform packages).
   */
  backendFactory?: MemoriesDatabaseBackendFactory;
  maxCached?: number;
  /** Structured telemetry for database lifecycle and HTTP node ops. */
  telemetry?: MemoriesTelemetry;
  /**
   * Cap on distinct namespaces per principal DB when serving HTTP (`undefined` = unlimited).
   * Pass through to {@link MemoriesServiceHttpOptions.maxNamespaces}.
   */
  maxNamespaces?: number;
};

export type LocalSqliteServiceStack = {
  service: MemoriesDatabaseService;
  placement: MemoriesDatabasePlacementStore;
  ontology: MemoriesDatabaseOntologyStore;
  catalog: MemoriesDatabaseCatalogStore;
  defaultStrategy: SqliteBackendStrategy;
  maxNamespaces?: number;
};

export function createLocalSqliteServiceStack(
  opts: CreateLocalSqliteServiceStackOptions,
): LocalSqliteServiceStack {
  ensureCustomSqliteForExtensions();
  const sqlCipherKey =
    typeof opts.sqlCipherKey === "string" && opts.sqlCipherKey.length > 0
      ? opts.sqlCipherKey
      : undefined;
  const defaultStrategy: SqliteBackendStrategy = {
    kind: "sqlite",
    dataDir: opts.dataDir,
    ...(sqlCipherKey !== undefined ? { sqlCipherKey } : {}),
  };
  const registryPath = opts.registryPath ?? path.join(opts.dataDir, "registry", "placements.db");
  const ontologyRegistryPath =
    opts.ontologyRegistryPath ?? path.join(opts.dataDir, "registry", "ontologies.db");
  const databaseCatalogRegistryPath =
    opts.databaseCatalogRegistryPath ?? path.join(opts.dataDir, "registry", "databases.db");
  const placement = createSqlitePlacementStore({
    registryPath,
    ...(sqlCipherKey !== undefined ? { sqlCipherKey } : {}),
    defaultStrategy,
  });
  const ontology = createSqliteOntologyStore({
    registryPath: ontologyRegistryPath,
    ...(sqlCipherKey !== undefined ? { sqlCipherKey } : {}),
  });
  const catalog = createSqliteDatabaseCatalogStore({
    registryPath: databaseCatalogRegistryPath,
    ...(sqlCipherKey !== undefined ? { sqlCipherKey } : {}),
  });
  const factory =
    opts.backendFactory ??
    createCompositeBackendFactory({
      sqlite: createLocalSqliteBackendFactory(),
    });
  const resolver = createBackendResolver({ placement, factory });
  const service = createMemoriesDatabaseService({
    resolver,
    maxCached: opts.maxCached,
    telemetry: opts.telemetry,
  });
  return {
    service,
    placement,
    ontology,
    catalog,
    defaultStrategy,
    ...(opts.maxNamespaces !== undefined ? { maxNamespaces: opts.maxNamespaces } : {}),
  };
}
