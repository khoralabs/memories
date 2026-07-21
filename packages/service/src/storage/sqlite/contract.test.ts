import { afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { TEST_SQLCIPHER_KEY } from "@khoralabs/sqlite-crypto";
import {
  runMemoriesDatabaseBackendContractTests,
  runMemoriesDatabaseOntologyStoreContractTests,
  runMemoriesDatabasePlacementStoreContractTests,
} from "../../testing/index";

import { createLocalSqliteBackend } from "./local-sqlite-backend";
import { createSqliteOntologyStore } from "./ontology-registry";
import { createSqlitePlacementStore } from "./placement-registry";

const tempDirs: string[] = [];

function makeTempDataDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "memories-storage-contract-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

runMemoriesDatabaseBackendContractTests(
  "sqlite",
  () => {
    const dataDir = makeTempDataDir();
    return createLocalSqliteBackend({
      strategy: {
        kind: "sqlite",
        dataDir,
        sqlCipherKey: TEST_SQLCIPHER_KEY,
      },
    });
  },
  {
    canEnumerate: true,
    supportsCheckpoint: true,
    supportsSnapshot: false,
    requiresSyncHandle: true,
    deleteClearsExistence: true,
  },
);

runMemoriesDatabasePlacementStoreContractTests("sqlite", () => {
  const dataDir = makeTempDataDir();
  return createSqlitePlacementStore({
    registryPath: path.join(dataDir, "registry", "placements.db"),
    sqlCipherKey: TEST_SQLCIPHER_KEY,
    defaultStrategy: {
      kind: "sqlite",
      dataDir,
      sqlCipherKey: TEST_SQLCIPHER_KEY,
    },
  });
});

runMemoriesDatabaseOntologyStoreContractTests("sqlite", () => {
  const dataDir = makeTempDataDir();
  return createSqliteOntologyStore({
    registryPath: path.join(dataDir, "registry", "ontologies.db"),
    sqlCipherKey: TEST_SQLCIPHER_KEY,
  });
});
