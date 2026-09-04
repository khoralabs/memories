import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ensureCustomSqliteForExtensions } from "@khoralabs/memories-node/sqlite";
import { TEST_SQLCIPHER_KEY } from "@khoralabs/sqlite-crypto";
import { createNoneAuthStrategy } from "../auth/index";
import {
  discoverMemoriesService,
  MEMORIES_ERROR_CODE,
  MEMORIES_HTTP_PATH,
  MemoriesServiceClient,
  MemoriesServiceClientError,
} from "../client/index";
import { createLocalSqliteServiceStack } from "../storage/sqlite/index";
import { handleMemoriesServiceHttpRequest } from "./handlers";

ensureCustomSqliteForExtensions();

const tempDirs: string[] = [];
const BASE = "http://boundary.test";

function makeTempDataDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "memories-boundary-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

function createTestStack() {
  const open = () =>
    createLocalSqliteServiceStack({
      dataDir: makeTempDataDir(),
      sqlCipherKey: TEST_SQLCIPHER_KEY,
    });
  try {
    return open();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/SQLite already loaded/i.test(msg)) throw e;
    return open();
  }
}

function createBoundaryFetch(
  stack: ReturnType<typeof createTestStack>,
  extras?: { discoveryAuthScheme?: "none" },
) {
  return async (url: string, init?: RequestInit): Promise<Response> => {
    const req = new Request(url, init);
    return handleMemoriesServiceHttpRequest(req, {
      service: stack.service,
      catalog: stack.catalog,
      ontology: stack.ontology,
      auth: createNoneAuthStrategy(),
      ...(extras?.discoveryAuthScheme !== undefined
        ? { discoveryAuthScheme: extras.discoveryAuthScheme }
        : {}),
    });
  };
}

describe("service↔client boundary contracts", () => {
  test("shared path constants match live health and discovery routes", async () => {
    const stack = createTestStack();
    const fetch = createBoundaryFetch(stack, { discoveryAuthScheme: "none" });
    const client = new MemoriesServiceClient({ baseUrl: BASE, fetch });

    const healthRes = await fetch(`${BASE}${MEMORIES_HTTP_PATH.health}`);
    expect(healthRes.status).toBe(200);
    expect(await healthRes.json()).toEqual({ ok: true });

    const doc = await discoverMemoriesService({
      baseUrl: BASE,
      fetch,
      requireAuthScheme: "none",
    });
    expect(doc.version).toBe(1);
    expect(doc.endpoints.health).toBe(MEMORIES_HTTP_PATH.health);
    expect(doc.endpoints.wellKnown).toBe(MEMORIES_HTTP_PATH.wellKnown);
    expect(doc.authScheme).toBe("none");

    await client.openDatabase({ kind: "account", ownerKey: "boundary" }, { name: "B" });
    expect(await client.databaseExists({ kind: "account", ownerKey: "boundary" })).toBe(true);
  });

  test("unknown route surfaces not_found code through MemoriesServiceClient", async () => {
    const stack = createTestStack();
    const client = new MemoriesServiceClient({
      baseUrl: BASE,
      fetch: createBoundaryFetch(stack),
    });
    try {
      await client.postJson("/no-such-route", {});
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(MemoriesServiceClientError);
      expect((e as MemoriesServiceClientError).status).toBe(404);
      expect((e as MemoriesServiceClientError).code).toBe(MEMORIES_ERROR_CODE.not_found);
    }
  });

  test("invalid request surfaces invalid_request code", async () => {
    const stack = createTestStack();
    const client = new MemoriesServiceClient({
      baseUrl: BASE,
      fetch: createBoundaryFetch(stack),
    });
    try {
      await client.postJson(MEMORIES_HTTP_PATH.databasesOpen, { not: "an-id" });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(MemoriesServiceClientError);
      expect((e as MemoriesServiceClientError).status).toBe(400);
      expect((e as MemoriesServiceClientError).code).toBe(MEMORIES_ERROR_CODE.invalid_request);
    }
  });
});
