import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { TEST_SQLCIPHER_KEY } from "@khoralabs/sqlite-crypto";

import { createLocalSqliteServiceStack, resolveLocalSqliteDatabasePath } from "./index";

const tempDirs: string[] = [];

function makeTempDataDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "memories-storage-sqlite-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

describe("local sqlite backend", () => {
  test("opens, lists, checkpoints, closes, and deletes databases", async () => {
    const dataDir = makeTempDataDir();
    const { service } = createLocalSqliteServiceStack({
      dataDir,
      sqlCipherKey: TEST_SQLCIPHER_KEY,
      maxCached: 2,
    });
    const id = { kind: "account", ownerKey: "owner-a" };

    expect(await service.exists(id)).toBe(false);
    await service.open(id);
    expect(await service.exists(id)).toBe(true);

    const dbPath = resolveLocalSqliteDatabasePath(dataDir, id);
    expect(dbPath.includes("/v1/account/")).toBe(true);

    const listed = await service.list({ kind: "account" });
    expect(listed).toEqual([id]);

    const first = await service.open(id);
    const second = await service.open(id);
    expect(first).toBe(second);

    await service.checkpoint(id);
    await service.close(id);
    expect(await service.exists(id)).toBe(true);

    const reopened = await service.open(id);
    expect(reopened).toBeDefined();

    await service.delete(id);
    expect(await service.exists(id)).toBe(false);
    expect(await service.list()).toEqual([]);
  });

  test("LRU evicts least-recently-used connection when maxCached is exceeded", async () => {
    const dataDir = makeTempDataDir();
    const { service } = createLocalSqliteServiceStack({
      dataDir,
      sqlCipherKey: TEST_SQLCIPHER_KEY,
      maxCached: 1,
    });

    const first = await service.open({ kind: "account", ownerKey: "first" });
    await service.open({ kind: "account", ownerKey: "second" });
    const firstAgain = await service.open({ kind: "account", ownerKey: "first" });

    expect(first).not.toBe(firstAgain);
    expect(await service.list()).toHaveLength(2);
  });

  test("delete closes cached handle before removing database files", async () => {
    const dataDir = makeTempDataDir();
    const { service } = createLocalSqliteServiceStack({
      dataDir,
      sqlCipherKey: TEST_SQLCIPHER_KEY,
      maxCached: 2,
    });
    const id = { kind: "account", ownerKey: "owner-delete" };

    await service.open(id);
    await service.delete(id);
    expect(await service.exists(id)).toBe(false);

    await service.open(id);
    expect(await service.exists(id)).toBe(true);
  });

  test("close releases cached handle and database can be reopened", async () => {
    const dataDir = makeTempDataDir();
    const { service } = createLocalSqliteServiceStack({
      dataDir,
      sqlCipherKey: TEST_SQLCIPHER_KEY,
      maxCached: 2,
    });
    const id = { kind: "account", ownerKey: "owner-close" };

    const first = await service.open(id);
    await service.close(id);
    const second = await service.open(id);
    expect(first).not.toBe(second);
    expect(await service.exists(id)).toBe(true);
  });

  test("handle close is idempotent", async () => {
    const dataDir = makeTempDataDir();
    const { service } = createLocalSqliteServiceStack({
      dataDir,
      sqlCipherKey: TEST_SQLCIPHER_KEY,
    });
    const id = { kind: "account", ownerKey: "owner-idempotent" };
    const handle = await service.getHandle(id);
    await handle.close();
    await handle.close();
  });
});
