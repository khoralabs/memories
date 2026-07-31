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
import { createLocalLibsqlBackendFactory } from "../libsql/index";
import { createTursoServerlessBackendFactory } from "../turso-serverless/index";
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
  /** Override the node backend factory; defaults to the local SQLite node backend. */
  backendFactory?: MemoriesDatabaseBackendFactory;
  maxCached?: number;
  /** Structured telemetry for database lifecycle and HTTP node ops. */
  telemetry?: MemoriesTelemetry;
};

export type LocalSqliteServiceStack = {
  service: MemoriesDatabaseService;
  placement: MemoriesDatabasePlacementStore;
  ontology: MemoriesDatabaseOntologyStore;
  catalog: MemoriesDatabaseCatalogStore;
  defaultStrategy: SqliteBackendStrategy;
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
      libsql: createLocalLibsqlBackendFactory(),
      "turso-serverless": createTursoServerlessBackendFactory(),
    });
  const resolver = createBackendResolver({ placement, factory });
  const service = createMemoriesDatabaseService({
    resolver,
    maxCached: opts.maxCached,
    telemetry: opts.telemetry,
  });
  return { service, placement, ontology, catalog, defaultStrategy };
}
