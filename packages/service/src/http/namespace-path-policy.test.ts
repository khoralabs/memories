import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ensureCustomSqliteForExtensions } from "@khoralabs/memories-node/sqlite";
import { TEST_SQLCIPHER_KEY } from "@khoralabs/sqlite-crypto";
import { createNoneAuthStrategy } from "../auth/index";
import { createLocalSqliteServiceStack } from "../storage/sqlite/index";

import { handleMemoriesServiceHttpRequest } from "./handlers";

ensureCustomSqliteForExtensions();

const tempDirs: string[] = [];

function makeTempDataDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "memories-ns-path-policy-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

function createTestStack(opts?: { maxNamespaceDepth?: number; maxNamespacePathLength?: number }) {
  const open = () =>
    createLocalSqliteServiceStack({
      dataDir: makeTempDataDir(),
      sqlCipherKey: TEST_SQLCIPHER_KEY,
      ...(opts?.maxNamespaceDepth !== undefined
        ? { maxNamespaceDepth: opts.maxNamespaceDepth }
        : {}),
      ...(opts?.maxNamespacePathLength !== undefined
        ? { maxNamespacePathLength: opts.maxNamespacePathLength }
        : {}),
    });
  try {
    return open();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/SQLite already loaded/i.test(msg)) throw e;
    return open();
  }
}

describe("namespace path policy http", () => {
  test("default policy rejects depth 7 on merge", async () => {
    const stack = createTestStack();
    const database = { kind: "account", ownerKey: "ns-depth-default" };
    await stack.service.open(database);
    const opts = {
      service: stack.service,
      catalog: stack.catalog,
      ontology: stack.ontology,
      auth: createNoneAuthStrategy(),
    };

    const res = await handleMemoriesServiceHttpRequest(
      new Request("http://localhost/databases/merge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          database,
          params: {
            kind: "node",
            key: "k1",
            namespace: "a/b/c/d/e/f/g",
            content: [{ key: "text", text: "deep" }],
            labels: [],
          },
        }),
      }),
      opts,
    );
    expect(res.status).toBe(400);
  });

  test("maxNamespaceDepth 8 accepts depth 7 on merge", async () => {
    const stack = createTestStack({ maxNamespaceDepth: 8 });
    const database = { kind: "account", ownerKey: "ns-depth-raised" };
    await stack.service.open(database);
    const opts = {
      service: stack.service,
      catalog: stack.catalog,
      ontology: stack.ontology,
      auth: createNoneAuthStrategy(),
      maxNamespaceDepth: 8,
    };

    const res = await handleMemoriesServiceHttpRequest(
      new Request("http://localhost/databases/merge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          database,
          params: {
            kind: "node",
            key: "k1",
            namespace: "a/b/c/d/e/f/g",
            content: [{ key: "text", text: "deep" }],
            labels: [],
          },
        }),
      }),
      opts,
    );
    expect(res.status).toBe(200);
  });

  test("default policy accepts path length 129", async () => {
    const stack = createTestStack();
    const database = { kind: "account", ownerKey: "ns-len-default" };
    await stack.service.open(database);
    const opts = {
      service: stack.service,
      catalog: stack.catalog,
      ontology: stack.ontology,
      auth: createNoneAuthStrategy(),
    };
    const namespace = "a".repeat(129);

    const res = await handleMemoriesServiceHttpRequest(
      new Request("http://localhost/databases/merge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          database,
          params: {
            kind: "node",
            key: "k1",
            namespace,
            content: [{ key: "text", text: "long" }],
            labels: [],
          },
        }),
      }),
      opts,
    );
    expect(res.status).toBe(200);
  });

  test("capabilities echoes configured namespaceLimits", async () => {
    const stack = createTestStack({
      maxNamespaceDepth: 12,
      maxNamespacePathLength: 1024,
    });
    const database = { kind: "account", ownerKey: "ns-caps-limits" };
    await stack.service.open(database);
    const opts = {
      service: stack.service,
      catalog: stack.catalog,
      ontology: stack.ontology,
      auth: createNoneAuthStrategy(),
      maxNamespaceDepth: 12,
      maxNamespacePathLength: 1024,
    };

    const res = await handleMemoriesServiceHttpRequest(
      new Request("http://localhost/databases/capabilities", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ database }),
      }),
      opts,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      namespaceLimits?: { maxDepth: number; maxLength: number };
    };
    expect(body.namespaceLimits).toEqual({ maxDepth: 12, maxLength: 1024 });
  });

  test("capabilities defaults to 6 / 512 when opts omitted", async () => {
    const stack = createTestStack();
    const database = { kind: "account", ownerKey: "ns-caps-defaults" };
    await stack.service.open(database);
    const opts = {
      service: stack.service,
      catalog: stack.catalog,
      ontology: stack.ontology,
      auth: createNoneAuthStrategy(),
    };

    const res = await handleMemoriesServiceHttpRequest(
      new Request("http://localhost/databases/capabilities", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ database }),
      }),
      opts,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      namespaceLimits?: { maxDepth: number; maxLength: number };
    };
    expect(body.namespaceLimits).toEqual({ maxDepth: 6, maxLength: 512 });
  });
});
