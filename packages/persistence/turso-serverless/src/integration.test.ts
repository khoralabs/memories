import { describe, expect, test } from "bun:test";
import { mergeMemoryAsync, searchAsync } from "@khoralabs/memories-core";
import { hasTursoIntegrationEnv, openTursoTestPersistence } from "./test-harness";

const integration = hasTursoIntegrationEnv();

describe.skipIf(!integration)("Turso integration", () => {
  test("mergeMemoryAsync + lexical search", async () => {
    const persistence = await openTursoTestPersistence();
    const ctx = { persistence };
    const ns = `test/${Date.now()}`;
    const key = "doc-a";

    await mergeMemoryAsync(ctx, {
      namespace: ns,
      key,
      content: [{ key: "body", text: "Turso serverless lexical integration smoke test" }],
      labels: [],
    });

    const hits = await searchAsync(ctx, {
      namespace: ns,
      content: { text: "serverless lexical" },
      options: { topK: 5 },
    });

    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.memory.key === key)).toBe(true);
  });
});

describe("integration env gate", () => {
  test("skips when credentials absent", () => {
    if (!integration) {
      expect(hasTursoIntegrationEnv()).toBe(false);
    }
  });
});
