import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createCompositeBackendFactory } from "@khoralabs/memories-service";
import type {
  MemoriesDatabaseBackend,
  MemoriesDatabaseBackendFactory,
  MemoriesDatabaseBackendStrategy,
  TursoServerlessBackendStrategy,
} from "@khoralabs/memories-service-storage-core";
import { unsupportedStorageFeature } from "@khoralabs/memories-service-storage-core";
import { ensureCustomSqliteForExtensions } from "@khoralabs/memories-sqlite";
import { TEST_SQLCIPHER_KEY } from "@khoralabs/sqlite-crypto";
import { createLocalSqliteBackendFactory } from "./local-sqlite-backend";
import { createLocalSqliteServiceStack } from "./stack";

ensureCustomSqliteForExtensions();

const tempDirs: string[] = [];

function makeTempDataDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "memories-stack-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

function createStubTursoBackend(strategy: TursoServerlessBackendStrategy): MemoriesDatabaseBackend {
  return {
    strategy,
    async open() {
      throw new Error("stub: no real persistence in tests");
    },
    async exists() {
      return false;
    },
    async list() {
      return [];
    },
    async delete() {},
    async checkpoint() {},
    async snapshot() {
      return unsupportedStorageFeature("snapshot", "turso-serverless");
    },
    async close() {},
  };
}

function createStubTursoFactory(): MemoriesDatabaseBackendFactory & {
  strategies: MemoriesDatabaseBackendStrategy[];
} {
  const strategies: MemoriesDatabaseBackendStrategy[] = [];
  return {
    strategies,
    create(strategy) {
      strategies.push(strategy);
      if (strategy.kind !== "turso-serverless") {
        throw new Error(`stub turso factory received unexpected kind: ${strategy.kind}`);
      }
      return createStubTursoBackend(strategy as TursoServerlessBackendStrategy);
    },
  };
}

describe("createLocalSqliteServiceStack", () => {
  test("routes turso-serverless placement overrides without UnknownBackendStrategyError", async () => {
    const dataDir = makeTempDataDir();
    const tursoFactory = createStubTursoFactory();
    const { service, placement } = createLocalSqliteServiceStack({
      dataDir,
      sqlCipherKey: TEST_SQLCIPHER_KEY,
      backendFactory: createCompositeBackendFactory({
        sqlite: createLocalSqliteBackendFactory(),
        "turso-serverless": tursoFactory,
      }),
    });

    const remoteId = { kind: "account", ownerKey: "turso-user" };
    await placement.setStrategy(remoteId, {
      kind: "turso-serverless",
      url: "libsql://turso-user.turso.io",
      authToken: "test-token",
    });

    // exists() reaches the turso backend — stub returns false rather than routing error.
    const exists = await service.exists(remoteId);
    expect(exists).toBe(false);
    expect(tursoFactory.strategies).toHaveLength(1);
    expect(tursoFactory.strategies[0]?.kind).toBe("turso-serverless");
  });

  test("placement store accepts turso-serverless strategies and persists them", async () => {
    const dataDir = makeTempDataDir();
    const { placement } = createLocalSqliteServiceStack({
      dataDir,
      sqlCipherKey: TEST_SQLCIPHER_KEY,
    });

    const remoteId = { kind: "account", ownerKey: "remote-owner" };
    const strategy = {
      kind: "turso-serverless" as const,
      url: "libsql://remote-owner.turso.io",
      authToken: "token",
    };
    await placement.setStrategy(remoteId, strategy);

    expect(await placement.getStrategy(remoteId)).toMatchObject(strategy);
  });

  test("local sqlite databases work normally when turso overrides are registered", async () => {
    const dataDir = makeTempDataDir();
    const { service, placement } = createLocalSqliteServiceStack({
      dataDir,
      sqlCipherKey: TEST_SQLCIPHER_KEY,
    });

    const localId = { kind: "account", ownerKey: "local-owner" };
    await service.open(localId);
    expect(await service.exists(localId)).toBe(true);

    await placement.setStrategy(
      { kind: "account", ownerKey: "remote-owner" },
      { kind: "turso-serverless", url: "libsql://remote-owner.turso.io" },
    );

    expect(await service.exists(localId)).toBe(true);
  });
});
