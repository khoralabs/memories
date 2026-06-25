import { describe, expect, test } from "bun:test";

import { createTursoServerlessBackendFactory } from "./turso-serverless-backend";

describe("createTursoServerlessBackendFactory", () => {
  test("creates a node backend with no physical listing support", async () => {
    const backend = createTursoServerlessBackendFactory().create({
      kind: "turso-serverless",
      url: "libsql://{ownerKey}.example.turso.io",
      authToken: "token",
    });

    expect(backend.strategy.kind).toBe("turso-serverless");
    expect(await backend.list()).toEqual([]);
  });

  test("rejects non-turso strategies", () => {
    expect(() =>
      createTursoServerlessBackendFactory().create({
        kind: "sqlite",
        dataDir: "/tmp/memories",
        sqlCipherKey: "secret",
      }),
    ).toThrow("Expected turso-serverless strategy");
  });
});
