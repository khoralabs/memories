import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { TEST_SQLCIPHER_KEY } from "@khoralabs/sqlite-crypto";

import { createInMemoryDatabaseCatalogStore } from "../core/database-catalog";
import { createSqliteDatabaseCatalogStore } from "./database-catalog-registry";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

describe("database catalog store", () => {
  test("in-memory upsert/get/list/remove", async () => {
    const catalog = createInMemoryDatabaseCatalogStore();
    const id = { kind: "account", ownerKey: "a" };
    expect(await catalog.get(id)).toBeUndefined();
    await catalog.upsert(id, { name: "A", description: "desc" });
    expect(await catalog.get(id)).toEqual({ name: "A", description: "desc" });
    expect(await catalog.list()).toHaveLength(1);
    await catalog.remove(id);
    expect(await catalog.get(id)).toBeUndefined();
  });

  test("sqlite registry persists metadata", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "memories-catalog-"));
    tempDirs.push(dir);
    const catalog = createSqliteDatabaseCatalogStore({
      registryPath: path.join(dir, "databases.db"),
      sqlCipherKey: TEST_SQLCIPHER_KEY,
    });
    const id = { kind: "organization", ownerKey: "org-1" };
    await catalog.upsert(id, { name: "Org", description: "Primary" });
    expect(await catalog.get(id)).toEqual({ name: "Org", description: "Primary" });
    await catalog.upsert(id, { description: "Updated" });
    expect(await catalog.get(id)).toEqual({ name: "Org", description: "Updated" });
  });
});
