import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { MemoriesClient } from "@khoralabs/memories-node";
import type { LabelSchemaMap, OntologyDefinition } from "@khoralabs/memories-node/ontology";
import { ensureCustomSqliteForExtensions } from "@khoralabs/memories-node/sqlite";
import { TEST_SQLCIPHER_KEY } from "@khoralabs/sqlite-crypto";
import {
  authorizeScopeAgainstGrants,
  createAppPolicyAuthStrategy,
  createNoneAuthStrategy,
  type HostGrant,
} from "../auth/index";
import { createLocalSqliteServiceStack } from "../storage/sqlite/index";

import { handleMemoriesServiceHttpRequest } from "./handlers";

ensureCustomSqliteForExtensions();

const tempDirs: string[] = [];

const testOntology: OntologyDefinition<LabelSchemaMap, LabelSchemaMap> = {
  nodeLabels: {},
  edgeLabels: {},
};

function makeTempDataDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "memories-source-map-authz-"));
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

function appPolicyAuth(grants: HostGrant[]) {
  return createAppPolicyAuthStrategy({
    async authenticate() {
      return { scheme: "app-policy", subject: "tester" };
    },
    async authorize(input) {
      authorizeScopeAgainstGrants(grants, input);
    },
  });
}

describe("source-map text IDOR authz", () => {
  test("grant on tenant-a cannot read tenant-b sourceMapId; covering grant or database-wide can", async () => {
    const stack = createTestStack();
    const database = { kind: "account", ownerKey: "idor-source-map" };
    await stack.service.open(database);
    const handle = await stack.service.getHandle(database);
    const sync = handle.sync;
    if (sync === undefined) throw new Error("expected sqlite handle");
    const client = new MemoriesClient(sync.syncPersistence, testOntology);

    client.mergeMemory({
      kind: "node",
      key: "a",
      namespace: "tenant-a",
      content: [{ key: "body", text: "secret-a" }],
      labels: [],
    });
    client.mergeMemory({
      kind: "node",
      key: "b",
      namespace: "tenant-b",
      content: [{ key: "body", text: "secret-b" }],
      labels: [],
    });

    const seedOpts = {
      service: stack.service,
      catalog: stack.catalog,
      ontology: stack.ontology,
      auth: createNoneAuthStrategy(),
    };
    const previewB = await handleMemoriesServiceHttpRequest(
      new Request("http://localhost/databases/memory-preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ database, namespace: "tenant-b", key: "b" }),
      }),
      seedOpts,
    );
    expect(previewB.status).toBe(200);
    const previewBody = (await previewB.json()) as {
      content: Array<{ sourceKey: string; sourceMapId: string }>;
    };
    const sourceMapId = previewBody.content.find((c) => c.sourceKey === "body")?.sourceMapId;
    expect(sourceMapId).toBeTruthy();
    if (sourceMapId === undefined) throw new Error("expected sourceMapId");

    for (const path of [
      "/databases/source-map/text",
      "/databases/source-map/text-preview",
    ] as const) {
      const tenantAOnly = appPolicyAuth([{ namespaces: ["tenant-a"], actions: ["read", "write"] }]);
      const denied = await handleMemoriesServiceHttpRequest(
        new Request(`http://localhost${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            database,
            sourceMapId,
            namespace: "tenant-a",
          }),
        }),
        {
          service: stack.service,
          catalog: stack.catalog,
          ontology: stack.ontology,
          auth: tenantAOnly,
        },
      );
      expect(denied.status).toBe(403);

      const deniedNoDecoy = await handleMemoriesServiceHttpRequest(
        new Request(`http://localhost${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ database, sourceMapId }),
        }),
        {
          service: stack.service,
          catalog: stack.catalog,
          ontology: stack.ontology,
          auth: tenantAOnly,
        },
      );
      expect(deniedNoDecoy.status).toBe(403);

      const tenantBGrant = appPolicyAuth([{ namespaces: ["tenant-b"], actions: ["read"] }]);
      const allowedNs = await handleMemoriesServiceHttpRequest(
        new Request(`http://localhost${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ database, sourceMapId }),
        }),
        {
          service: stack.service,
          catalog: stack.catalog,
          ontology: stack.ontology,
          auth: tenantBGrant,
        },
      );
      expect(allowedNs.status).toBe(200);
      const allowedNsBody = (await allowedNs.json()) as { text: string };
      expect(allowedNsBody.text).toContain("secret-b");

      const databaseWide = appPolicyAuth([{ actions: ["read"] }]);
      const allowedDb = await handleMemoriesServiceHttpRequest(
        new Request(`http://localhost${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ database, sourceMapId }),
        }),
        {
          service: stack.service,
          catalog: stack.catalog,
          ontology: stack.ontology,
          auth: databaseWide,
        },
      );
      expect(allowedDb.status).toBe(200);
      const allowedDbBody = (await allowedDb.json()) as { text: string };
      expect(allowedDbBody.text).toContain("secret-b");
    }
  });
});
