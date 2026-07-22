import path from "node:path";
import { ensureCustomSqliteForExtensions } from "@khoralabs/memories-node/sqlite";
import {
  createBackendResolver,
  createCompositeBackendFactory,
  createMemoriesDatabaseService,
  type MemoriesDatabaseService,
} from "../../service/index";
import type {
  MemoriesDatabaseBackendFactory,
  MemoriesDatabaseOntologyStore,
  MemoriesDatabasePlacementStore,
  SqliteBackendStrategy,
} from "../../storage/core/index";
import { createLocalLibsqlBackendFactory } from "../libsql/index";
import { createTursoServerlessBackendFactory } from "../turso-serverless/index";
import { createLocalSqliteBackendFactory } from "./local-sqlite-backend";
import { createSqliteOntologyStore } from "./ontology-registry";
import { createSqlitePlacementStore } from "./placement-registry";

export type CreateLocalSqliteServiceStackOptions = {
  dataDir: string;
  sqlCipherKey: string;
  registryPath?: string;
  ontologyRegistryPath?: string;
  /** Override the node backend factory; defaults to the local SQLite node backend. */
  backendFactory?: MemoriesDatabaseBackendFactory;
  maxCached?: number;
};

export type LocalSqliteServiceStack = {
  service: MemoriesDatabaseService;
  placement: MemoriesDatabasePlacementStore;
  ontology: MemoriesDatabaseOntologyStore;
  defaultStrategy: SqliteBackendStrategy;
};

export function createLocalSqliteServiceStack(
  opts: CreateLocalSqliteServiceStackOptions,
): LocalSqliteServiceStack {
  ensureCustomSqliteForExtensions();
  const defaultStrategy: SqliteBackendStrategy = {
    kind: "sqlite",
    dataDir: opts.dataDir,
    sqlCipherKey: opts.sqlCipherKey,
  };
  const registryPath = opts.registryPath ?? path.join(opts.dataDir, "registry", "placements.db");
  const ontologyRegistryPath =
    opts.ontologyRegistryPath ?? path.join(opts.dataDir, "registry", "ontologies.db");
  const placement = createSqlitePlacementStore({
    registryPath,
    sqlCipherKey: opts.sqlCipherKey,
    defaultStrategy,
  });
  const ontology = createSqliteOntologyStore({
    registryPath: ontologyRegistryPath,
    sqlCipherKey: opts.sqlCipherKey,
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
  });
  return { service, placement, ontology, defaultStrategy };
}
