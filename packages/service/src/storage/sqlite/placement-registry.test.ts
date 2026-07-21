import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ensureCustomSqliteForExtensions } from "@khoralabs/memories-node/sqlite";
import { TEST_SQLCIPHER_KEY } from "@khoralabs/sqlite-crypto";

import { resolveLocalSqliteDatabasePath } from "./local-sqlite-backend";
import { createSqlitePlacementStore } from "./placement-registry";
import { createLocalSqliteServiceStack } from "./stack";

ensureCustomSqliteForExtensions();

const tempDirs: string[] = [];

function makeTempDataDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "memories-placement-registry-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

/** Durability + service routing. Placement CRUD lives in the shared contract suite. */
describe("sqlite placement registry", () => {
  test("persists default strategy and per-principal overrides across reopen", async () => {
    const dataDir = makeTempDataDir();
    const registryPath = path.join(dataDir, "registry", "placements.db");
    const defaultStrategy = {
      kind: "sqlite" as const,
      dataDir,
      sqlCipherKey: TEST_SQLCIPHER_KEY,
    };

    const store = createSqlitePlacementStore({
      registryPath,
      sqlCipherKey: TEST_SQLCIPHER_KEY,
      defaultStrategy,
    });

    const override = {
      kind: "sqlite" as const,
      dataDir: path.join(dataDir, "alt"),
      sqlCipherKey: TEST_SQLCIPHER_KEY,
    };
    const id = { kind: "account", ownerKey: "owner-a" };
    await store.setStrategy(id, override);

    const reloaded = createSqlitePlacementStore({
      registryPath,
      sqlCipherKey: TEST_SQLCIPHER_KEY,
      defaultStrategy,
    });

    expect(await reloaded.getDefaultStrategy()).toEqual(defaultStrategy);
    expect(await reloaded.getStrategy(id)).toEqual(override);
    expect(await reloaded.listOverrides()).toEqual([{ id, strategy: override }]);
  });

  test("stack resolves override through service open", async () => {
    const dataDir = makeTempDataDir();
    const orgDataDir = path.join(dataDir, "org-host");
    const { service, placement } = createLocalSqliteServiceStack({
      dataDir,
      sqlCipherKey: TEST_SQLCIPHER_KEY,
    });
    const id = { kind: "organization", ownerKey: "org-1" };
    await placement.setStrategy(id, {
      kind: "sqlite",
      dataDir: orgDataDir,
      sqlCipherKey: TEST_SQLCIPHER_KEY,
    });

    await service.open(id);
    expect(await service.exists(id)).toBe(true);
    const dbPath = resolveLocalSqliteDatabasePath(orgDataDir, id);
    expect(dbPath.includes("/v1/")).toBe(true);
    expect(dbPath.endsWith("/database.db")).toBe(true);
    expect(dbPath.includes("/organization/")).toBe(false);
  });

  test("service.list includes databases routed through placement overrides", async () => {
    const dataDir = makeTempDataDir();
    const orgDataDir = path.join(dataDir, "org-host");
    const { service, placement } = createLocalSqliteServiceStack({
      dataDir,
      sqlCipherKey: TEST_SQLCIPHER_KEY,
    });
    const defaultId = { kind: "account", ownerKey: "default-owner" };
    const overrideId = { kind: "organization", ownerKey: "org-hosted" };

    await service.open(defaultId);
    await placement.setStrategy(overrideId, {
      kind: "sqlite",
      dataDir: orgDataDir,
      sqlCipherKey: TEST_SQLCIPHER_KEY,
    });
    await service.open(overrideId);

    const listed = await service.list();
    expect(listed.sort((a, b) => a.ownerKey.localeCompare(b.ownerKey))).toEqual(
      [defaultId, overrideId].sort((a, b) => a.ownerKey.localeCompare(b.ownerKey)),
    );
  });
});
