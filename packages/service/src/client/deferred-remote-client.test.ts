import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { LabelSchemaMap, OntologyDefinition } from "@khoralabs/memories-node/ontology";
import { TEST_SQLCIPHER_KEY } from "@khoralabs/sqlite-crypto";
import { createNoneAuthStrategy } from "../auth/index";
import { handleMemoriesServiceHttpRequest } from "../http/handlers";
import { createLocalSqliteServiceStack } from "../storage/sqlite/index";
import {
  createDeferredRemoteMemoriesClientAsync,
  createRemoteMemoriesClientAsync,
  readyDeferredRemoteMemoriesClientAsync,
} from "./index";

const tempDirs: string[] = [];

const testOntology: OntologyDefinition<LabelSchemaMap, LabelSchemaMap> = {
  nodeLabels: {},
  edgeLabels: {},
};

function makeTempDataDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "memories-deferred-remote-"));
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

describe("createDeferredRemoteMemoriesClientAsync", () => {
  test("does not hit the network until the first operation", async () => {
    const stack = createTestStack();
    const database = { kind: "account", ownerKey: "deferred-lazy" };
    let requestCount = 0;
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        requestCount += 1;
        return handleMemoriesServiceHttpRequest(req, {
          service: stack.service,
          ontology: stack.ontology,
          auth: createNoneAuthStrategy(),
        });
      },
    });

    try {
      const client = createDeferredRemoteMemoriesClientAsync({
        baseUrl: `http://localhost:${server.port}`,
        database,
        ontology: testOntology,
      });
      expect(requestCount).toBe(0);

      await client.mergeMemory({
        kind: "node",
        key: "note-1",
        namespace: "user/deferred",
        content: [{ key: "text", text: "hello deferred" }],
        labels: [],
      });
      expect(requestCount).toBeGreaterThan(0);
    } finally {
      server.stop(true);
    }
  }, 15_000);

  test("reuses one underlying client across operations", async () => {
    const stack = createTestStack();
    const database = { kind: "account", ownerKey: "deferred-reuse" };
    let capabilitiesCount = 0;
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/databases/capabilities") {
          capabilitiesCount += 1;
        }
        return handleMemoriesServiceHttpRequest(req, {
          service: stack.service,
          ontology: stack.ontology,
          auth: createNoneAuthStrategy(),
        });
      },
    });

    try {
      const client = createDeferredRemoteMemoriesClientAsync({
        baseUrl: `http://localhost:${server.port}`,
        database,
        ontology: testOntology,
      });

      await client.mergeMemory({
        kind: "node",
        key: "note-1",
        namespace: "user/deferred",
        content: [{ key: "text", text: "hello" }],
        labels: [],
      });
      await client.search({
        namespace: "user/deferred",
        content: { text: "hello" },
        options: { topK: 3, arms: { lexical: 1, vector: 0 } },
      });
      await client.deleteMemory({ namespace: "user/deferred", key: "note-1" });

      expect(capabilitiesCount).toBe(1);
      expect(client.ontology).toEqual(testOntology);
    } finally {
      server.stop(true);
    }
  }, 15_000);

  test("forwards provenance head and timestamp via persistence", async () => {
    const stack = createTestStack();
    const database = { kind: "account", ownerKey: "deferred-prov" };
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        return handleMemoriesServiceHttpRequest(req, {
          service: stack.service,
          ontology: stack.ontology,
          auth: createNoneAuthStrategy(),
        });
      },
    });

    try {
      const client = createDeferredRemoteMemoriesClientAsync({
        baseUrl: `http://localhost:${server.port}`,
        database,
        ontology: testOntology,
      });

      await client.mergeMemory({
        kind: "node",
        key: "note-1",
        namespace: "user/deferred",
        content: [{ key: "text", text: "prov hello" }],
        labels: [],
      });

      const rootHex = await client.persistence.getProvenanceHeadRootHex?.call(client.persistence);
      expect(typeof rootHex).toBe("string");
      expect((rootHex ?? "").length).toBeGreaterThan(0);
      if (rootHex === undefined || rootHex.length === 0) {
        throw new Error("expected provenance head rootHex");
      }

      const timestampMs = await client.persistence.getProvenanceTimestampMsForRootHex?.call(
        client.persistence,
        rootHex,
      );
      expect(typeof timestampMs).toBe("number");
    } finally {
      server.stop(true);
    }
  }, 15_000);

  test("throws on ontology read before materialization", () => {
    const client = createDeferredRemoteMemoriesClientAsync({
      baseUrl: "http://localhost:1",
      database: { kind: "account", ownerKey: "deferred-ontology" },
      ontology: testOntology,
    });
    expect(() => client.ontology).toThrow(/ontology.*unavailable/i);
  });

  test("readyDeferredRemoteMemoriesClientAsync materializes and returns the concrete client", async () => {
    const stack = createTestStack();
    const database = { kind: "account", ownerKey: "deferred-ready" };
    let capabilitiesCount = 0;
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/databases/capabilities") {
          capabilitiesCount += 1;
        }
        return handleMemoriesServiceHttpRequest(req, {
          service: stack.service,
          ontology: stack.ontology,
          auth: createNoneAuthStrategy(),
        });
      },
    });

    try {
      const deferred = createDeferredRemoteMemoriesClientAsync({
        baseUrl: `http://localhost:${server.port}`,
        database,
        ontology: testOntology,
      });

      const [a, b] = await Promise.all([
        readyDeferredRemoteMemoriesClientAsync(deferred),
        readyDeferredRemoteMemoriesClientAsync(deferred),
      ]);
      expect(capabilitiesCount).toBe(1);
      expect(a).toBe(b);
      expect(a.ontology).toEqual(testOntology);
      expect(a).not.toBe(deferred);

      const again = await readyDeferredRemoteMemoriesClientAsync(deferred);
      expect(again).toBe(a);
      expect(capabilitiesCount).toBe(1);
    } finally {
      server.stop(true);
    }
  }, 15_000);

  test("readyDeferredRemoteMemoriesClientAsync is a no-op for eager clients", async () => {
    const stack = createTestStack();
    const database = { kind: "account", ownerKey: "deferred-eager" };
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        return handleMemoriesServiceHttpRequest(req, {
          service: stack.service,
          ontology: stack.ontology,
          auth: createNoneAuthStrategy(),
        });
      },
    });

    try {
      const eager = await createRemoteMemoriesClientAsync({
        baseUrl: `http://localhost:${server.port}`,
        database,
        ontology: testOntology,
      });
      await expect(readyDeferredRemoteMemoriesClientAsync(eager)).resolves.toBe(eager);
    } finally {
      server.stop(true);
    }
  }, 15_000);
});
