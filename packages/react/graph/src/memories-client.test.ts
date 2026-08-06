import { describe, expect, mock, test } from "bun:test";
import { createHttpReactMemoriesClient } from "./memories-client.ts";

type FetchCall = {
  url: string;
  init?: RequestInit;
};

function jsonResponse(body: unknown, init?: { status?: number; statusText?: string }): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    statusText: init?.statusText ?? "OK",
    headers: { "Content-Type": "application/json" },
  });
}

function mockFetch(handler: (call: FetchCall) => Response | Promise<Response>) {
  const calls: FetchCall[] = [];
  const fetchFn = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const call = { url, init };
    calls.push(call);
    return handler(call);
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

describe("createHttpReactMemoriesClient", () => {
  test("strips trailing slash from baseUrl", async () => {
    const { fetchFn, calls } = mockFetch(() => jsonResponse({ namespaces: [] }));
    const client = createHttpReactMemoriesClient({
      baseUrl: "/api/memories/",
      fetch: fetchFn,
    });
    await client.listNamespaces();
    expect(calls[0]?.url).toBe("/api/memories/namespaces");
  });

  test("defaults credentials to include", async () => {
    const { fetchFn, calls } = mockFetch(() => jsonResponse({ namespaces: [] }));
    const client = createHttpReactMemoriesClient({
      baseUrl: "/api",
      fetch: fetchFn,
    });
    await client.listNamespaces();
    expect(calls[0]?.init?.credentials).toBe("include");
  });

  test("passes custom credentials", async () => {
    const { fetchFn, calls } = mockFetch(() => jsonResponse({ namespaces: [] }));
    const client = createHttpReactMemoriesClient({
      baseUrl: "/api",
      credentials: "omit",
      fetch: fetchFn,
    });
    await client.listNamespaces();
    expect(calls[0]?.init?.credentials).toBe("omit");
  });

  test("listNamespaces returns payload and forwards signal", async () => {
    const signal = new AbortController().signal;
    const payload = {
      namespaces: [{ namespace: "global", alias: null, description: "" }],
      namespaceRoot: "global",
      profiles: [{ profileId: "p1", namespace: "user/p1", indexed: true }],
    };
    const { fetchFn, calls } = mockFetch(() => jsonResponse(payload));
    const client = createHttpReactMemoriesClient({ baseUrl: "/api", fetch: fetchFn });
    await expect(client.listNamespaces({ signal })).resolves.toEqual(payload);
    expect(calls[0]?.url).toBe("/api/namespaces");
    expect(calls[0]?.init?.signal).toBe(signal);
  });

  test("getGraph builds query and defaults missing nodes/edges", async () => {
    const { fetchFn, calls } = mockFetch(() => jsonResponse({ namespace: "a/b" }));
    const client = createHttpReactMemoriesClient({ baseUrl: "/api", fetch: fetchFn });
    const graph = await client.getGraph({ namespace: "a/b", scope: "subtree" });
    expect(calls[0]?.url).toBe("/api/graph?namespace=a%2Fb&scope=subtree");
    expect(graph).toEqual({ namespace: "a/b", nodes: [], edges: [] });
  });

  test("getGraph omits scope for exact", async () => {
    const { fetchFn, calls } = mockFetch(() =>
      jsonResponse({
        namespace: "ns",
        nodes: [
          {
            key: "k",
            x: 0,
            y: 0,
            z: 0,
            labels: [],
            degree: { count: 0, centrality: 0 },
          },
        ],
        edges: [],
      }),
    );
    const client = createHttpReactMemoriesClient({ baseUrl: "/api", fetch: fetchFn });
    await client.getGraph({ namespace: "ns" });
    expect(calls[0]?.url).toBe("/api/graph?namespace=ns");
  });

  test("search POSTs defaults and normalizes snippets", async () => {
    const { fetchFn, calls } = mockFetch(() =>
      jsonResponse({
        hitCount: 2,
        keys: ["a", "b"],
        hitKeys: ["a"],
        neighborKeys: ["b"],
        hitSnippets: [
          { key: " a ", text: "hit", sourceKey: "src" },
          { key: "  ", text: "skip" },
          { key: "b", text: null },
        ],
        edgeHitSnippets: [
          { edgeId: " e1 ", fromKey: "a", toKey: "b", text: "edge" },
          { edgeId: "", text: "bad" },
        ],
      }),
    );
    const client = createHttpReactMemoriesClient({ baseUrl: "/api", fetch: fetchFn });
    const result = await client.search({
      namespace: "ns",
      query: "hello",
      maxVectorDistance: 0.65,
      scope: "subtree",
    });

    expect(calls[0]?.url).toBe("/api/search");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      namespace: "ns",
      query: "hello",
      topK: 10,
      maxNeighbors: 5,
      maxVectorDistance: 0.65,
      scope: "subtree",
    });
    expect(result).toEqual({
      hitCount: 2,
      hitKeys: ["a"],
      neighborKeys: ["b"],
      keys: ["a", "b"],
      hitSnippets: [
        { key: "a", sourceKey: "src", text: "hit" },
        { key: "b", text: null },
      ],
      edgeHitSnippets: [{ edgeId: "e1", fromKey: "a", toKey: "b", text: "edge" }],
    });
  });

  test("search omits optional fields when not provided", async () => {
    const { fetchFn, calls } = mockFetch(() => jsonResponse({}));
    const client = createHttpReactMemoriesClient({ baseUrl: "/api", fetch: fetchFn });
    const result = await client.search({ namespace: "ns", query: "q" });
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      namespace: "ns",
      query: "q",
      topK: 10,
      maxNeighbors: 5,
    });
    expect(result).toEqual({
      hitCount: 0,
      keys: [],
      hitSnippets: [],
      edgeHitSnippets: [],
    });
  });

  test("getEdgePreview encodes namespace and edgeId", async () => {
    const preview = {
      edgeId: "e/1",
      fromKey: "a",
      toKey: "b",
      labels: [],
      properties: null,
    };
    const { fetchFn, calls } = mockFetch(() => jsonResponse(preview));
    const client = createHttpReactMemoriesClient({ baseUrl: "/api", fetch: fetchFn });
    await expect(client.getEdgePreview({ namespace: "n/s", edgeId: "e/1" })).resolves.toEqual(
      preview,
    );
    expect(calls[0]?.url).toBe("/api/edge-preview?namespace=n%2Fs&edgeId=e%2F1");
  });

  test("investigate POSTs question and returns answer fields", async () => {
    const { fetchFn, calls } = mockFetch(() =>
      jsonResponse({
        answer: "yes",
        citations: [{ memory_key: "k" }],
        follow_up_queries: ["why?"],
      }),
    );
    const client = createHttpReactMemoriesClient({ baseUrl: "/api", fetch: fetchFn });
    const answer = await client.investigate?.({ namespace: "ns", question: "q?" });
    expect(calls[0]?.url).toBe("/api/investigate");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      namespace: "ns",
      question: "q?",
    });
    expect(answer).toEqual({
      answer: "yes",
      citations: [{ memory_key: "k" }],
      follow_up_queries: ["why?"],
    });
  });

  test("throws on HTTP error status using json.error", async () => {
    const { fetchFn } = mockFetch(() =>
      jsonResponse({ error: "not configured" }, { status: 503, statusText: "Service Unavailable" }),
    );
    const client = createHttpReactMemoriesClient({ baseUrl: "/api", fetch: fetchFn });
    await expect(client.listNamespaces()).rejects.toThrow("not configured");
  });

  test("throws on HTTP error status using statusText when no json.error", async () => {
    const { fetchFn } = mockFetch(() =>
      jsonResponse({}, { status: 500, statusText: "Internal Server Error" }),
    );
    const client = createHttpReactMemoriesClient({ baseUrl: "/api", fetch: fetchFn });
    await expect(client.getGraph({ namespace: "ns" })).rejects.toThrow("Internal Server Error");
  });

  test("throws when response JSON includes error with ok status", async () => {
    const { fetchFn } = mockFetch(() => jsonResponse({ error: "bad query" }));
    const client = createHttpReactMemoriesClient({ baseUrl: "/api", fetch: fetchFn });
    await expect(client.search({ namespace: "ns", query: "x" })).rejects.toThrow("bad query");
  });
});
