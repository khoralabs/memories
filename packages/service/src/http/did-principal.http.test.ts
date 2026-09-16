import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { generateIdentity } from "@khoralabs/did-key-identity";
import { ensureCustomSqliteForExtensions } from "@khoralabs/memories-node/sqlite";
import { TEST_SQLCIPHER_KEY } from "@khoralabs/sqlite-crypto";

import {
  createDidKeyPrincipalVerifier,
  createDidPrincipalAuthStrategy,
  signAgentRequest,
} from "../auth/index";
import { createLocalSqliteServiceStack } from "../storage/sqlite/index";
import { MEMORIES_HTTP_PATH } from "./contracts/routes";
import { handleMemoriesServiceHttpRequest } from "./handlers";

ensureCustomSqliteForExtensions();

const tempDirs: string[] = [];

function makeTempDataDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "memories-did-http-"));
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

async function signedRequest(
  signer: Awaited<ReturnType<typeof generateIdentity>>,
  method: string,
  pathName: string,
  body?: unknown,
): Promise<Request> {
  const bodyText = body === undefined ? "" : JSON.stringify(body);
  const { headers } = await signAgentRequest({
    method,
    path: pathName,
    bodyText,
    signer,
  });
  return new Request(`http://localhost${pathName}`, {
    method,
    headers: {
      ...headers,
      ...(bodyText.length > 0 ? { "content-type": "application/json" } : {}),
    },
    ...(bodyText.length > 0 ? { body: bodyText } : {}),
  });
}

describe("did-principal HTTP", () => {
  test("owner can open own DB; list filters; non-owner denied", async () => {
    const { service, catalog, ontology } = createTestStack();
    const owner = await generateIdentity();
    const other = await generateIdentity();
    const auth = createDidPrincipalAuthStrategy({
      verify: createDidKeyPrincipalVerifier(),
    });
    const db = { kind: "account" as const, ownerKey: owner.did };

    const openRes = await handleMemoriesServiceHttpRequest(
      await signedRequest(owner, "POST", MEMORIES_HTTP_PATH.databasesOpen, db),
      { service, catalog, ontology, auth, discoveryAuthScheme: "did-principal" },
    );
    expect(openRes.status).toBe(200);

    const listOwner = await handleMemoriesServiceHttpRequest(
      await signedRequest(owner, "GET", MEMORIES_HTTP_PATH.databases),
      { service, catalog, ontology, auth },
    );
    expect(listOwner.status).toBe(200);
    const ownerBody = (await listOwner.json()) as { databases: Array<{ id: typeof db }> };
    expect(ownerBody.databases.some((e) => e.id.ownerKey === owner.did)).toBe(true);

    const listOther = await handleMemoriesServiceHttpRequest(
      await signedRequest(other, "GET", MEMORIES_HTTP_PATH.databases),
      { service, catalog, ontology, auth },
    );
    expect(listOther.status).toBe(200);
    const otherBody = (await listOther.json()) as { databases: Array<{ id: typeof db }> };
    expect(otherBody.databases.some((e) => e.id.ownerKey === owner.did)).toBe(false);

    const existsOther = await handleMemoriesServiceHttpRequest(
      await signedRequest(other, "POST", MEMORIES_HTTP_PATH.databasesExists, db),
      { service, catalog, ontology, auth },
    );
    expect(existsOther.status).toBe(403);
  });

  test("unscoped ontology register rejects missing auth with 401", async () => {
    const { service, catalog, ontology } = createTestStack();
    const auth = createDidPrincipalAuthStrategy({
      verify: createDidKeyPrincipalVerifier(),
    });
    const res = await handleMemoriesServiceHttpRequest(
      new Request(`http://localhost${MEMORIES_HTTP_PATH.ontologiesRegister}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
      { service, catalog, ontology, auth },
    );
    expect(res.status).toBe(401);
  });

  test("authenticated DID can register ontology via signed POST", async () => {
    const { service, catalog, ontology } = createTestStack();
    const actor = await generateIdentity();
    const auth = createDidPrincipalAuthStrategy({
      verify: createDidKeyPrincipalVerifier(),
    });
    const schema = {
      $schema: "https://json-schema.org/draft/2020-12/schema" as const,
      type: "object",
      properties: {
        nodeLabels: {
          type: "object",
          additionalProperties: false,
          properties: {
            fact: {
              type: "object",
              properties: { text: { type: "string" } },
              required: ["text"],
              additionalProperties: false,
            },
          },
        },
        edgeLabels: {
          type: "object",
          additionalProperties: false,
          properties: {
            relates_to: {
              type: "object",
              properties: {},
              additionalProperties: false,
            },
          },
        },
      },
      required: ["nodeLabels", "edgeLabels"],
      additionalProperties: false,
    };
    const res = await handleMemoriesServiceHttpRequest(
      await signedRequest(actor, "POST", MEMORIES_HTTP_PATH.ontologiesRegister, { schema }),
      { service, catalog, ontology, auth },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { hash: string };
    expect(typeof body.hash).toBe("string");
    expect(body.hash.length).toBeGreaterThan(0);
  });
});
