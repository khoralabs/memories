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
  const dir = mkdtempSync(path.join(tmpdir(), "memories-feature-inv-"));
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

describe("feature inventory + single-arm replace", () => {
  test("memory-preview returns inventory fields; full text and replace preserve sibling arm", async () => {
    const stack = createTestStack();
    const database = { kind: "account", ownerKey: "feat-inv" };
    await stack.service.open(database);
    const opts = {
      service: stack.service,
      catalog: stack.catalog,
      ontology: stack.ontology,
      auth: createNoneAuthStrategy(),
    };

    const longText = `${"x".repeat(3000)}-tail`;
    const merge = await handleMemoriesServiceHttpRequest(
      new Request("http://localhost/databases/merge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          database,
          params: {
            kind: "node",
            key: "m1",
            namespace: "ns",
            content: [
              { key: "body", text: longText },
              { key: "note", text: "keep-me" },
            ],
            labels: [],
          },
        }),
      }),
      opts,
    );
    expect(merge.status).toBe(200);

    const preview = await handleMemoriesServiceHttpRequest(
      new Request("http://localhost/databases/memory-preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ database, namespace: "ns", key: "m1", maxChars: 100 }),
      }),
      opts,
    );
    expect(preview.status).toBe(200);
    const previewBody = (await preview.json()) as {
      content: Array<{
        sourceKey: string;
        sourceMapId: string;
        text: string | null;
        hasText: boolean;
        hasVector: boolean;
        createdAt: number;
      }>;
    };
    expect(previewBody.content.length).toBe(2);
    const bodyArm = previewBody.content.find((c) => c.sourceKey === "body");
    const noteArm = previewBody.content.find((c) => c.sourceKey === "note");
    expect(bodyArm?.hasText).toBe(true);
    expect(bodyArm?.hasVector).toBe(false);
    expect(bodyArm?.sourceMapId.length).toBeGreaterThan(0);
    expect(bodyArm?.text).not.toBeNull();
    expect(bodyArm?.text?.length).toBeLessThan(longText.length);
    expect(bodyArm?.text?.endsWith("…")).toBe(true);
    expect(noteArm?.text).toBe("keep-me");

    const full = await handleMemoriesServiceHttpRequest(
      new Request("http://localhost/databases/source-map/text", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ database, sourceMapId: bodyArm?.sourceMapId }),
      }),
      opts,
    );
    expect(full.status).toBe(200);
    const fullBody = (await full.json()) as { text: string | null };
    expect(fullBody.text).toBe(longText);

    const replace = await handleMemoriesServiceHttpRequest(
      new Request("http://localhost/databases/source-map/replace", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          database,
          namespace: "ns",
          key: "m1",
          sourceKey: "body",
          text: "replaced-body",
        }),
      }),
      opts,
    );
    expect(replace.status).toBe(200);
    const replaceBody = (await replace.json()) as { sourceMapId: string; rootHex: string };
    expect(replaceBody.sourceMapId).toBe(bodyArm?.sourceMapId);
    expect(replaceBody.rootHex.length).toBeGreaterThan(0);

    const preview2 = await handleMemoriesServiceHttpRequest(
      new Request("http://localhost/databases/memory-preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ database, namespace: "ns", key: "m1" }),
      }),
      opts,
    );
    const preview2Body = (await preview2.json()) as {
      content: Array<{ sourceKey: string; text: string | null }>;
      labels: unknown[];
    };
    expect(preview2Body.content.find((c) => c.sourceKey === "body")?.text).toBe("replaced-body");
    expect(preview2Body.content.find((c) => c.sourceKey === "note")?.text).toBe("keep-me");

    const missing = await handleMemoriesServiceHttpRequest(
      new Request("http://localhost/databases/source-map/replace", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          database,
          namespace: "ns",
          key: "nope",
          sourceKey: "body",
          text: "x",
        }),
      }),
      opts,
    );
    expect(missing.status).toBe(404);
  });
});
