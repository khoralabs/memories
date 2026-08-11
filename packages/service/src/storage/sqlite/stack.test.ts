import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ensureCustomSqliteForExtensions } from "@khoralabs/memories-node/sqlite";
import { TEST_SQLCIPHER_KEY } from "@khoralabs/sqlite-crypto";
import { createCompositeBackendFactory } from "../../service/index";
import type {
  MemoriesDatabaseBackend,
  MemoriesDatabaseBackendFactory,
  MemoriesDatabaseBackendStrategy,
  TursoServerlessBackendStrategy,
} from "../../storage/core/index";
import { unsupportedStorageFeature } from "../../storage/core/index";
import { createLocalSqliteBackendFactory } from "./local-sqlite-backend";
import { createLocalSqliteServiceStack } from "./stack";

ensureCustomSqliteForExtensions();

const tempDirs: string[] = [];

function makeTempDataDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "memories-stack-"));
  tempDirs.push(dir);
  return dir;
}

function createStack(
  opts: Parameters<typeof createLocalSqliteServiceStack>[0],
): ReturnType<typeof createLocalSqliteServiceStack> {
  const open = () => createLocalSqliteServiceStack(opts);
  try {
    return open();
  } catch (e) {
    // First open can race: custom libsqlite vs SQLCipher setCustomSQLite.
    const msg = e instanceof Error ? e.message : String(e);
    if (!/SQLite already loaded/i.test(msg)) throw e;
    return open();
  }
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
    const { service, placement } = createStack({
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

  test("routes libsql placement overrides when libsql factory is registered", async () => {
    const { createLocalLibsqlBackendFactory } = await import("../libsql/index");
    const dataDir = makeTempDataDir();
    const libsqlDataDir = makeTempDataDir();
    const { service, placement } = createStack({
      dataDir,
      sqlCipherKey: TEST_SQLCIPHER_KEY,
      backendFactory: createCompositeBackendFactory({
        sqlite: createLocalSqliteBackendFactory(),
        libsql: createLocalLibsqlBackendFactory(),
      }),
    });

    const libsqlId = { kind: "account", ownerKey: "libsql-user" };
    await placement.setStrategy(libsqlId, {
      kind: "libsql",
      dataDir: libsqlDataDir,
      encryptionKey: "test-libsql-key",
    });

    await service.open(libsqlId);
    expect(await service.exists(libsqlId)).toBe(true);
    await service.close(libsqlId);
  });

  test("default stack rejects libsql placement without a registered factory", async () => {
    const { UnknownBackendStrategyError } = await import("../../service/backend-factory");
    const dataDir = makeTempDataDir();
    const libsqlDataDir = makeTempDataDir();
    const { service, placement } = createStack({
      dataDir,
      sqlCipherKey: TEST_SQLCIPHER_KEY,
    });

    const libsqlId = { kind: "account", ownerKey: "libsql-user" };
    await placement.setStrategy(libsqlId, {
      kind: "libsql",
      dataDir: libsqlDataDir,
      encryptionKey: "test-libsql-key",
    });

    await expect(service.exists(libsqlId)).rejects.toBeInstanceOf(UnknownBackendStrategyError);
  });

  test("placement store accepts turso-serverless strategies and persists them", async () => {
    const dataDir = makeTempDataDir();
    const { placement } = createStack({
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
    const { service, placement } = createStack({
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

  test("opens plaintext stack when sqlCipherKey is omitted", async () => {
    const dataDir = makeTempDataDir();
    const { service, defaultStrategy } = createStack({ dataDir });

    expect(defaultStrategy.kind).toBe("sqlite");
    expect(defaultStrategy.sqlCipherKey).toBeUndefined();

    const id = { kind: "account", ownerKey: "plaintext-owner" };
    await service.open(id);
    expect(await service.exists(id)).toBe(true);
  });
});
