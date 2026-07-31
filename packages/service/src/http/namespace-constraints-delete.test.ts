import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NamespaceConstraintError } from "@khoralabs/memories-node";
import { ensureCustomSqliteForExtensions } from "@khoralabs/memories-node/sqlite";
import { TEST_SQLCIPHER_KEY } from "@khoralabs/sqlite-crypto";
import { createNoneAuthStrategy } from "../auth/index";
import { createLocalSqliteServiceStack } from "../storage/sqlite/index";

import { handleMemoriesServiceHttpRequest } from "./handlers";

ensureCustomSqliteForExtensions();

const tempDirs: string[] = [];

function makeTempDataDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "memories-ns-delete-"));
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

describe("namespace constraints + delete http", () => {
  test("maxNamespaces rejects new path on merge and allows existing", async () => {
    const stack = createTestStack(1);
    const database = { kind: "account", ownerKey: "ns-cap" };
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
            namespace: "ns/a",
            content: [{ key: "text", text: "one" }],
            labels: [],
          },
        }),
      }),
      opts,
    );
    expect(first.status).toBe(200);

    const second = await handleMemoriesServiceHttpRequest(
      new Request("http://localhost/databases/merge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          database,
          params: {
            kind: "node",
            key: "k2",
            namespace: "ns/b",
            content: [{ key: "text", text: "two" }],
            labels: [],
          },
        }),
      }),
      opts,
    );
    expect(second.status).toBe(400);
    expect(await second.json()).toMatchObject({
      error: expect.stringContaining("namespace limit exceeded"),
    });

    const sameNs = await handleMemoriesServiceHttpRequest(
      new Request("http://localhost/databases/merge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          database,
          params: {
            kind: "node",
            key: "k3",
            namespace: "ns/a",
            content: [{ key: "text", text: "three" }],
            labels: [],
          },
        }),
      }),
      opts,
    );
    expect(sameNs.status).toBe(200);
  });

  test("omit maxNamespaces leaves namespaces unbounded over HTTP", async () => {
    const stack = createTestStack();
    const database = { kind: "account", ownerKey: "ns-unbounded" };
    await stack.service.open(database);
    const opts = {
      service: stack.service,
      catalog: stack.catalog,
      ontology: stack.ontology,
      auth: createNoneAuthStrategy(),
      // maxNamespaces intentionally omitted
    };

    for (let i = 0; i < 5; i++) {
      const res = await handleMemoriesServiceHttpRequest(
        new Request("http://localhost/databases/merge", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            database,
            params: {
              kind: "node",
              key: `k${i}`,
              namespace: `ns/${i}`,
              content: [{ key: "text", text: `t${i}` }],
              labels: [],
            },
          }),
        }),
        opts,
      );
      expect(res.status).toBe(200);
    }
  });

  test("deleteNamespace recursive removes children; exact leaves children", async () => {
    const stack = createTestStack();
    const database = { kind: "account", ownerKey: "ns-del" };
    await stack.service.open(database);
    const opts = {
      service: stack.service,
      catalog: stack.catalog,
      ontology: stack.ontology,
      auth: createNoneAuthStrategy(),
    };

    async function merge(namespace: string, key: string, text: string) {
      const res = await handleMemoriesServiceHttpRequest(
        new Request("http://localhost/databases/merge", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            database,
            params: {
              kind: "node",
              key,
              namespace,
              content: [{ key: "text", text }],
              labels: [],
            },
          }),
        }),
        opts,
      );
      expect(res.status).toBe(200);
    }

    await merge("team", "root", "root");
    await merge("team/project", "child", "child");

    const metaUpsert = await handleMemoriesServiceHttpRequest(
      new Request("http://localhost/databases/namespaces/upsert", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          database,
          namespace: "team/meta-only",
          alias: "Meta",
        }),
      }),
      opts,
    );
    expect(metaUpsert.status).toBe(200);

    const exact = await handleMemoriesServiceHttpRequest(
      new Request("http://localhost/databases/namespaces/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ database, namespace: "team", recursive: false }),
      }),
      opts,
    );
    expect(exact.status).toBe(200);
    const exactBody = (await exact.json()) as { deletedMemories: number; namespaces: string[] };
    expect(exactBody.namespaces).toEqual(["team"]);
    expect(exactBody.deletedMemories).toBe(1);

    const afterExact = await handleMemoriesServiceHttpRequest(
      new Request("http://localhost/databases/namespaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ database }),
      }),
      opts,
    );
    const afterExactBody = (await afterExact.json()) as {
      namespaces: Array<{ namespace: string }>;
    };
    expect(afterExactBody.namespaces.map((n) => n.namespace).sort()).toEqual([
      "team/meta-only",
      "team/project",
    ]);

    const recursive = await handleMemoriesServiceHttpRequest(
      new Request("http://localhost/databases/namespaces/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ database, namespace: "team" }),
      }),
      opts,
    );
    expect(recursive.status).toBe(200);
    const recBody = (await recursive.json()) as { deletedMemories: number; namespaces: string[] };
    expect(recBody.namespaces).toContain("team/project");
    expect(recBody.namespaces).toContain("team/meta-only");
    expect(recBody.deletedMemories).toBe(1);

    const afterRec = await handleMemoriesServiceHttpRequest(
      new Request("http://localhost/databases/namespaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ database }),
      }),
      opts,
    );
    const afterRecBody = (await afterRec.json()) as { namespaces: Array<{ namespace: string }> };
    expect(afterRecBody.namespaces).toEqual([]);
  });

  test("depth-7 path throws NamespaceConstraintError in node", () => {
    expect(() => {
      throw new NamespaceConstraintError("max_depth", "test");
    }).toThrow(NamespaceConstraintError);
  });
});
