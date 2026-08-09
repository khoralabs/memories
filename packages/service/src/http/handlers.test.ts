import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ensureCustomSqliteForExtensions } from "@khoralabs/memories-node/sqlite";
import { TEST_SQLCIPHER_KEY } from "@khoralabs/sqlite-crypto";
import {
  type AuthorizeScope,
  createAppPolicyAuthStrategy,
  createNoneAuthStrategy,
  createServerAdminAuthStrategy,
} from "../auth/index";
import { createLocalSqliteServiceStack } from "../storage/sqlite/index";

import {
  scopeFromMemoryBody,
  scopeFromNamespaceDelete,
  scopeFromNamespaceMutation,
  scopeFromRename,
} from "./authorize-scope";
import { handleMemoriesServiceHttpRequest } from "./handlers";

ensureCustomSqliteForExtensions();

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

describe("memories service http handlers", () => {
  test("lists databases with none auth", async () => {
    const { service, catalog } = createTestStack();
    await service.open({ kind: "account", ownerKey: "owner-a" });
    await catalog.upsert(
      { kind: "account", ownerKey: "owner-a" },
      {
        name: "Owner A",
        description: "Test db",
      },
    );

    const response = await handleMemoriesServiceHttpRequest(
      new Request("http://localhost/databases"),
      { service, catalog, auth: createNoneAuthStrategy() },
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      databases: Array<{
        id: { kind: string; ownerKey: string };
        name: string;
        description: string;
      }>;
    };
    expect(body.databases).toEqual([
      {
        id: { kind: "account", ownerKey: "owner-a" },
        name: "Owner A",
        description: "Test db",
      },
    ]);
  });

  test("database metadata get/upsert and open with name", async () => {
    const { service, catalog } = createTestStack();
    const database = { kind: "account", ownerKey: "owner-meta" };
    const auth = createNoneAuthStrategy();

    const openRes = await handleMemoriesServiceHttpRequest(
      new Request("http://localhost/databases/open", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...database, name: "Meta DB", description: "From open" }),
      }),
      { service, catalog, auth },
    );
    expect(openRes.status).toBe(200);
    expect(await catalog.get(database)).toEqual({
      name: "Meta DB",
      description: "From open",
    });

    const upsertRes = await handleMemoriesServiceHttpRequest(
      new Request("http://localhost/databases/metadata/upsert", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ database, description: "Updated" }),
      }),
      { service, catalog, auth },
    );
    expect(upsertRes.status).toBe(200);

    const getRes = await handleMemoriesServiceHttpRequest(
      new Request("http://localhost/databases/metadata/get", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ database }),
      }),
      { service, catalog, auth },
    );
    expect(getRes.status).toBe(200);
    expect(await getRes.json()).toMatchObject({
      name: "Meta DB",
      description: "Updated",
      database,
    });

    await handleMemoriesServiceHttpRequest(
      new Request("http://localhost/databases", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(database),
      }),
      { service, catalog, auth },
    );
    expect(await catalog.get(database)).toBeUndefined();
  });

  test("namespace metadata get/upsert and enriched list", async () => {
    const stack = createTestStack();
    const database = { kind: "account", ownerKey: "owner-ns-meta" };
    await stack.service.open(database);
    const auth = createNoneAuthStrategy();
    const opts = {
      service: stack.service,
      catalog: stack.catalog,
      ontology: stack.ontology,
      auth,
    };

    const upsertRes = await handleMemoriesServiceHttpRequest(
      new Request("http://localhost/databases/namespaces/upsert", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          database,
          namespace: "user/inbox",
          alias: "Inbox",
          description: "Primary inbox",
        }),
      }),
      opts,
    );
    expect(upsertRes.status).toBe(200);

    const getRes = await handleMemoriesServiceHttpRequest(
      new Request("http://localhost/databases/namespaces/get", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ database, namespace: "user/inbox" }),
      }),
      opts,
    );
    expect(getRes.status).toBe(200);
    expect(await getRes.json()).toMatchObject({
      namespace: {
        namespace: "user/inbox",
        alias: "Inbox",
        description: "Primary inbox",
        suppressed: false,
      },
    });

    const listRes = await handleMemoriesServiceHttpRequest(
      new Request("http://localhost/databases/namespaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ database }),
      }),
      opts,
    );
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as {
      namespaces: Array<{
        namespace: string;
        alias: string | null;
        description: string;
        suppressed: boolean;
      }>;
    };
    expect(listBody.namespaces).toContainEqual({
      namespace: "user/inbox",
      alias: "Inbox",
      description: "Primary inbox",
      suppressed: false,
    });
  });

  test("requires admin token for server-admin auth", async () => {
    const { service } = createTestStack();
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
    const { service } = createTestStack();
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

  test("app-policy authorize receives namespace from search body", async () => {
    const { service } = createTestStack();
    const database = { kind: "account", ownerKey: "owner-ns" };
    await service.open(database);

    let seenNamespace: string | undefined;
    let seenScope: AuthorizeScope | undefined;
    const auth = createAppPolicyAuthStrategy({
      async authenticate() {
        return { scheme: "app-policy", subject: "tester" };
      },
      async authorize(input) {
        seenNamespace = input.namespace;
        seenScope = input.scope;
      },
    });

    const response = await handleMemoriesServiceHttpRequest(
      new Request("http://localhost/databases/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          database,
          params: {
            namespace: "user/a",
            content: { text: "hello" },
            options: { topK: 5, arms: { lexical: 1, vector: 0 } },
          },
        }),
      }),
      { service, auth },
    );

    expect(response.status).toBe(200);
    expect(seenNamespace).toBe("user/a");
    expect(seenScope).toEqual({ kind: "namespace", namespace: "user/a", mode: "exact" });
  });

  test("app-policy authorize receives rename and unscoped/multi-ns scopes", async () => {
    const { service } = createTestStack();
    const database = { kind: "account", ownerKey: "owner-scopes" };
    await service.open(database);

    const seen: AuthorizeScope[] = [];
    const auth = createAppPolicyAuthStrategy({
      async authenticate() {
        return { scheme: "app-policy", subject: "tester" };
      },
      async authorize(input) {
        seen.push(input.scope);
      },
    });

    const rename = await handleMemoriesServiceHttpRequest(
      new Request("http://localhost/databases/namespaces/rename", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          database,
          from: "old/path",
          to: "new/path",
          recursive: false,
        }),
      }),
      { service, auth },
    );
    // rename may 400 if source missing; auth still runs first
    expect(rename.status === 200 || rename.status === 400).toBe(true);
    expect(seen.at(-1)).toEqual({
      kind: "namespaceRename",
      from: "old/path",
      to: "new/path",
      mode: "exact",
    });

    const unscoped = await handleMemoriesServiceHttpRequest(
      new Request("http://localhost/databases/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          database,
          params: {
            namespace: "ignored",
            searchEntireDatabase: true,
            content: { text: "hello" },
            options: { topK: 5, arms: { lexical: 1, vector: 0 } },
          },
        }),
      }),
      { service, auth },
    );
    expect(unscoped.status).toBe(200);
    expect(seen.at(-1)).toEqual({ kind: "unscoped" });

    const multi = await handleMemoriesServiceHttpRequest(
      new Request("http://localhost/databases/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          database,
          params: {
            namespace: "a",
            additionalNamespaces: ["b", "a"],
            content: { text: "hello" },
            options: { topK: 5, arms: { lexical: 1, vector: 0 } },
          },
        }),
      }),
      { service, auth },
    );
    expect(multi.status).toBe(200);
    expect(seen.at(-1)).toEqual({
      kind: "namespaces",
      namespaces: ["a", "b"],
      mode: "exact",
    });

    const delSubtree = await handleMemoriesServiceHttpRequest(
      new Request("http://localhost/databases/namespaces/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ database, namespace: "team" }),
      }),
      { service, auth },
    );
    expect(delSubtree.status).toBe(200);
    expect(seen.at(-1)).toEqual({ kind: "namespace", namespace: "team", mode: "subtree" });

    const delExact = await handleMemoriesServiceHttpRequest(
      new Request("http://localhost/databases/namespaces/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ database, namespace: "team", recursive: false }),
      }),
      { service, auth },
    );
    expect(delExact.status).toBe(200);
    expect(seen.at(-1)).toEqual({ kind: "namespace", namespace: "team", mode: "exact" });
  });
});

describe("authorize-scope extractors", () => {
  test("scopeFromRename and recursive modes", () => {
    expect(scopeFromRename({ from: "a", to: "b" })).toEqual({
      kind: "namespaceRename",
      from: "a",
      to: "b",
      mode: "subtree",
    });
    expect(scopeFromRename({ from: "a", to: "b", recursive: false })).toEqual({
      kind: "namespaceRename",
      from: "a",
      to: "b",
      mode: "exact",
    });
  });

  test("scopeFromNamespaceMutation exact; delete uses recursive default", () => {
    expect(scopeFromNamespaceMutation({ namespace: "x" })).toEqual({
      kind: "namespace",
      namespace: "x",
      mode: "exact",
    });
    expect(scopeFromNamespaceDelete({ namespace: "x" })).toEqual({
      kind: "namespace",
      namespace: "x",
      mode: "subtree",
    });
    expect(scopeFromNamespaceDelete({ namespace: "x", recursive: false })).toEqual({
      kind: "namespace",
      namespace: "x",
      mode: "exact",
    });
  });

  test("scopeFromMemoryBody unscoped and multi", () => {
    expect(
      scopeFromMemoryBody({
        params: { namespace: "n", searchEntireDatabase: true },
      }),
    ).toEqual({ kind: "unscoped" });
    expect(
      scopeFromMemoryBody({
        namespace: "a",
        additionalNamespaces: ["b"],
        searchScopeMode: "pathSubtree",
      }),
    ).toEqual({ kind: "namespaces", namespaces: ["a", "b"], mode: "subtree" });
  });
});
