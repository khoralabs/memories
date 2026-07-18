import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { TEST_SQLCIPHER_KEY } from "@khoralabs/sqlite-crypto";

import {
  type CreateLocalSqliteServiceStackOptions,
  createLocalSqliteServiceStack,
  resolveLocalSqliteDatabasePath,
} from "./index";

const tempDirs: string[] = [];

function makeTempDataDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "memories-storage-sqlite-"));
  tempDirs.push(dir);
  return dir;
}

function createStack(
  opts: Omit<CreateLocalSqliteServiceStackOptions, "dataDir" | "sqlCipherKey"> & {
    dataDir?: string;
  } = {},
) {
  const dataDir = opts.dataDir ?? makeTempDataDir();
  const open = () =>
    createLocalSqliteServiceStack({
      ...opts,
      dataDir,
      sqlCipherKey: TEST_SQLCIPHER_KEY,
    });
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

/** Service-stack / filesystem layout coverage. Backend lifecycle lives in the shared contract suite. */
describe("local sqlite service stack", () => {
  test("path encoding uses /v1/ without kind segment", async () => {
    const dataDir = makeTempDataDir();
    const { service } = createStack({ dataDir });
    const id = { kind: "account", ownerKey: "owner-a" };
    await service.open(id);

    const dbPath = resolveLocalSqliteDatabasePath(dataDir, id);
    expect(dbPath.endsWith("/v1/")).toBe(false);
    expect(dbPath.includes("/v1/")).toBe(true);
    expect(dbPath.endsWith("/database.db")).toBe(true);
    expect(dbPath.includes("/account/")).toBe(false);
  });

  test("same owner key with different kinds uses separate folders", async () => {
    const dataDir = makeTempDataDir();
    const { service } = createStack({ dataDir });
    const ownerKey = "shared-owner";
    const account = { kind: "account", ownerKey };
    const organization = { kind: "organization", ownerKey };

    await service.open(account);
    await service.open(organization);

    const accountPath = resolveLocalSqliteDatabasePath(dataDir, account);
    const organizationPath = resolveLocalSqliteDatabasePath(dataDir, organization);
    expect(accountPath).not.toBe(organizationPath);

    expect(await service.list({ kind: "account" })).toEqual([account]);
    expect(await service.list({ kind: "organization" })).toEqual([organization]);
    expect(await service.list()).toHaveLength(2);
  });

  test("LRU evicts least-recently-used connection when maxCached is exceeded", async () => {
    const { service } = createStack({ maxCached: 1 });

    const first = await service.open({ kind: "account", ownerKey: "first" });
    await service.open({ kind: "account", ownerKey: "second" });
    const firstAgain = await service.open({ kind: "account", ownerKey: "first" });

    expect(first).not.toBe(firstAgain);
    expect(await service.list()).toHaveLength(2);
  });

  test("delete closes cached handle before removing database files", async () => {
    const { service } = createStack({ maxCached: 2 });
    const id = { kind: "account", ownerKey: "owner-delete" };

    await service.open(id);
    await service.delete(id);
    expect(await service.exists(id)).toBe(false);

    await service.open(id);
    expect(await service.exists(id)).toBe(true);
  });

  test("close releases cached handle and database can be reopened", async () => {
    const { service } = createStack({ maxCached: 2 });
    const id = { kind: "account", ownerKey: "owner-close" };

    const first = await service.open(id);
    await service.close(id);
    const second = await service.open(id);
    expect(first).not.toBe(second);
    expect(await service.exists(id)).toBe(true);
  });

  test("service open returns the same cached handle", async () => {
    const { service } = createStack({ maxCached: 2 });
    const id = { kind: "account", ownerKey: "owner-cache" };
    const first = await service.open(id);
    const second = await service.open(id);
    expect(first).toBe(second);
  });
});
