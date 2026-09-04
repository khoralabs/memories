import { describe, expect, test } from "bun:test";
import { MemoriesServiceClientError } from "./client";
import { discoverMemoriesService } from "./discover";

const validDoc = {
  version: 1 as const,
  endpoints: { health: "/health", wellKnown: "/.well-known/memories" },
  authScheme: "none" as const,
};

describe("discoverMemoriesService", () => {
  test("parses well-known document", async () => {
    const doc = await discoverMemoriesService({
      baseUrl: "http://s",
      fetch: async () => new Response(JSON.stringify(validDoc), { status: 200 }),
    });
    expect(doc.authScheme).toBe("none");
  });

  test("rejects protocol version mismatch with 409", async () => {
    try {
      await discoverMemoriesService({
        baseUrl: "http://s",
        fetch: async () =>
          new Response(JSON.stringify({ ...validDoc, version: 2 }), { status: 200 }),
      });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(MemoriesServiceClientError);
      expect((e as MemoriesServiceClientError).status).toBe(409);
    }
  });

  test("rejects authScheme mismatch", async () => {
    try {
      await discoverMemoriesService({
        baseUrl: "http://s",
        requireAuthScheme: "server-admin",
        fetch: async () => new Response(JSON.stringify(validDoc), { status: 200 }),
      });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(MemoriesServiceClientError);
      expect((e as MemoriesServiceClientError).message).toContain("authScheme");
    }
  });
});
