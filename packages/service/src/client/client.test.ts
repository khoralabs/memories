import { describe, expect, test } from "bun:test";

import { MEMORIES_ERROR_CODE } from "../http/contracts/error-codes";
import {
  createBearerTokenAuthProvider,
  createNoAuthProvider,
  MemoriesServiceClient,
  MemoriesServiceClientError,
} from "./client";

describe("memories service client", () => {
  test("sends bearer auth and JSON bodies", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const client = new MemoriesServiceClient({
      baseUrl: "http://localhost:8787",
      auth: createBearerTokenAuthProvider("secret-token"),
      fetch: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return new Response(JSON.stringify({ exists: true }), { status: 200 });
      },
    });

    const exists = await client.databaseExists({ kind: "account", ownerKey: "owner-a" });
    expect(exists).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("http://localhost:8787/databases/exists");
    expect(new Headers(calls[0]?.init.headers).get("authorization")).toBe("Bearer secret-token");
    expect(calls[0]?.init.body).toBe(JSON.stringify({ kind: "account", ownerKey: "owner-a" }));
  });

  test("supports no-auth provider", async () => {
    const client = new MemoriesServiceClient({
      baseUrl: "http://localhost:8787",
      auth: createNoAuthProvider(),
      fetch: async () =>
        new Response(
          JSON.stringify({
            databases: [
              {
                id: { kind: "account", ownerKey: "owner-a" },
                name: "",
                description: "",
              },
            ],
          }),
          { status: 200 },
        ),
    });

    const databases = await client.listDatabases();
    expect(databases).toEqual([
      { id: { kind: "account", ownerKey: "owner-a" }, name: "", description: "" },
    ]);
  });

  test("preserves status and code on failed responses", async () => {
    const client = new MemoriesServiceClient({
      baseUrl: "http://localhost:8787",
      fetch: async () =>
        new Response(JSON.stringify({ error: "memory not found", code: "not_found" }), {
          status: 404,
        }),
    });
    try {
      await client.postJson("/databases/memory-detail", {});
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(MemoriesServiceClientError);
      expect((e as MemoriesServiceClientError).status).toBe(404);
      expect((e as MemoriesServiceClientError).code).toBe(MEMORIES_ERROR_CODE.not_found);
      expect((e as MemoriesServiceClientError).message).toBe("memory not found");
      expect((e as MemoriesServiceClientError).bodyText).toContain("not_found");
    }
  });

  test("falls back to status-based code when envelope omits code", async () => {
    const client = new MemoriesServiceClient({
      baseUrl: "http://localhost:8787",
      fetch: async () => new Response(JSON.stringify({ error: "nope" }), { status: 403 }),
    });
    try {
      await client.listDatabases();
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(MemoriesServiceClientError);
      expect((e as MemoriesServiceClientError).status).toBe(403);
      expect((e as MemoriesServiceClientError).code).toBe(MEMORIES_ERROR_CODE.forbidden);
    }
  });
});
