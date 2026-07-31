import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ids } from "@khoralabs/memories-node";
import { ensureCustomSqliteForExtensions } from "@khoralabs/memories-node/sqlite";
import { TEST_SQLCIPHER_KEY } from "@khoralabs/sqlite-crypto";
import { createNoneAuthStrategy } from "../auth/index";
import { createLocalSqliteServiceStack } from "../storage/sqlite/index";

import { handleMemoriesServiceHttpRequest } from "./handlers";

ensureCustomSqliteForExtensions();

const tempDirs: string[] = [];

function makeTempDataDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "memories-ns-rename-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

function createTestStack(maxNamespaces?: number) {
  const open = () =>
    createLocalSqliteServiceStack({
      dataDir: makeTempDataDir(),
      sqlCipherKey: TEST_SQLCIPHER_KEY,
      ...(maxNamespaces !== undefined ? { maxNamespaces } : {}),
    });
  try {
    return open();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/SQLite already loaded/i.test(msg)) throw e;
    return open();
  }
}

describe("namespace rename http", () => {
  test("renames path and rematerializes memory id", async () => {
    const stack = createTestStack();
    const database = { kind: "account", ownerKey: "ns-rename" };
    await stack.service.open(database);
    const opts = {
      service: stack.service,
      catalog: stack.catalog,
      ontology: stack.ontology,
      auth: createNoneAuthStrategy(),
    };

    const merge = await handleMemoriesServiceHttpRequest(
      new Request("http://localhost/databases/merge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          database,
          params: {
            kind: "node",
            key: "k1",
            namespace: "old/ns",
            content: [{ key: "text", text: "hello" }],
            labels: [],
          },
        }),
      }),
      opts,
    );
    expect(merge.status).toBe(200);

    const meta = await handleMemoriesServiceHttpRequest(
      new Request("http://localhost/databases/namespaces/upsert", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          database,
          namespace: "old/ns",
          alias: "Alias",
        }),
      }),
      opts,
    );
    expect(meta.status).toBe(200);

    const rename = await handleMemoriesServiceHttpRequest(
      new Request("http://localhost/databases/namespaces/rename", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ database, from: "old/ns", to: "new/ns" }),
      }),
      opts,
    );
    expect(rename.status).toBe(200);
    const body = (await rename.json()) as { renamedMemories: number };
    expect(body.renamedMemories).toBe(1);

    const findOld = await handleMemoriesServiceHttpRequest(
      new Request("http://localhost/databases/find-memory-id", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ database, namespace: "old/ns", key: "k1" }),
      }),
      opts,
    );
    expect(findOld.status).toBe(200);
    expect(await findOld.json()).toMatchObject({ memoryId: null });

    const findNew = await handleMemoriesServiceHttpRequest(
      new Request("http://localhost/databases/find-memory-id", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ database, namespace: "new/ns", key: "k1" }),
      }),
      opts,
    );
    expect(findNew.status).toBe(200);
    expect(await findNew.json()).toMatchObject({
      memoryId: ids.memory("new/ns", "k1"),
    });

    const getMeta = await handleMemoriesServiceHttpRequest(
      new Request("http://localhost/databases/namespaces/get", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ database, namespace: "new/ns" }),
      }),
      opts,
    );
    expect(await getMeta.json()).toMatchObject({
      namespace: { namespace: "new/ns", alias: "Alias" },
    });
  });

  test("maxNamespaces allows 1:1 rename rewrite", async () => {
    const stack = createTestStack(1);
    const database = { kind: "account", ownerKey: "ns-rename-cap" };
    await stack.service.open(database);
    const opts = {
      service: stack.service,
      catalog: stack.catalog,
      ontology: stack.ontology,
      auth: createNoneAuthStrategy(),
      maxNamespaces: 1,
    };

    const first = await handleMemoriesServiceHttpRequest(
      new Request("http://localhost/databases/merge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          database,
          params: {
            kind: "node",
            key: "k1",
            namespace: "occupied",
            content: [{ key: "text", text: "x" }],
            labels: [],
          },
        }),
      }),
      opts,
    );
    expect(first.status).toBe(200);

    const okRename = await handleMemoriesServiceHttpRequest(
      new Request("http://localhost/databases/namespaces/rename", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ database, from: "occupied", to: "moved" }),
      }),
      opts,
    );
    expect(okRename.status).toBe(200);

    const failUpsert = await handleMemoriesServiceHttpRequest(
      new Request("http://localhost/databases/namespaces/upsert", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ database, namespace: "extra", alias: "Y" }),
      }),
      opts,
    );
    expect(failUpsert.status).toBe(400);
  });

  test("invalid depth to returns 400", async () => {
    const stack = createTestStack();
    const database = { kind: "account", ownerKey: "ns-rename-depth" };
    await stack.service.open(database);
    const opts = {
      service: stack.service,
      catalog: stack.catalog,
      ontology: stack.ontology,
      auth: createNoneAuthStrategy(),
    };
    const res = await handleMemoriesServiceHttpRequest(
      new Request("http://localhost/databases/namespaces/rename", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          database,
          from: "a",
          to: "a/b/c/d/e/f/g",
        }),
      }),
      opts,
    );
    expect(res.status).toBe(400);
  });
});
