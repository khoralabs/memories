import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createNoneAuthStrategy,
  createServerAdminAuthStrategy,
} from "@khoralabs/memories-service-auth";
import { createLocalSqliteServiceStack } from "@khoralabs/memories-service-storage-sqlite";
import { TEST_SQLCIPHER_KEY } from "@khoralabs/sqlite-crypto";

import { handleMemoriesServiceHttpRequest } from "./handlers";

const tempDirs: string[] = [];

function makeTempDataDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "memories-service-http-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

function createTestService() {
  return createLocalSqliteServiceStack({
    dataDir: makeTempDataDir(),
    sqlCipherKey: TEST_SQLCIPHER_KEY,
  }).service;
}

describe("memories service http handlers", () => {
  test("lists databases with none auth", async () => {
    const service = createTestService();
    await service.open({ kind: "account", ownerKey: "owner-a" });

    const response = await handleMemoriesServiceHttpRequest(
      new Request("http://localhost/databases"),
      { service, auth: createNoneAuthStrategy() },
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      databases: Array<{ kind: string; ownerKey: string }>;
    };
    expect(body.databases).toEqual([{ kind: "account", ownerKey: "owner-a" }]);
  });

  test("requires admin token for server-admin auth", async () => {
    const service = createTestService();
    const auth = createServerAdminAuthStrategy({ adminToken: "admin-secret" });

    const unauthorized = await handleMemoriesServiceHttpRequest(
      new Request("http://localhost/databases"),
      { service, auth },
    );
    expect(unauthorized.status).toBe(401);

    const authorized = await handleMemoriesServiceHttpRequest(
      new Request("http://localhost/databases", {
        headers: { authorization: "Bearer admin-secret" },
      }),
      { service, auth },
    );
    expect(authorized.status).toBe(200);
  });

  test("opens database via POST body id", async () => {
    const service = createTestService();
    const response = await handleMemoriesServiceHttpRequest(
      new Request("http://localhost/databases/open", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "organization", ownerKey: "org-1" }),
      }),
      { service, auth: createNoneAuthStrategy() },
    );

    expect(response.status).toBe(200);
    expect(await service.exists({ kind: "organization", ownerKey: "org-1" })).toBe(true);
  });
});
