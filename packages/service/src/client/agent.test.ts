import { afterEach, describe, expect, test } from "bun:test";
import { defineOntology } from "@khoralabs/memories-node/ontology";
import { z } from "zod";

import {
  AGENT_MEMORY_EDGE_KIND,
  AGENT_MEMORY_NODE_KIND,
  agentMemoriesDatabase,
  createDeferredAgentMemoriesClient,
  installMemoriesServiceFetch,
  memoriesServiceFetch,
  resolveAgentMemoriesOntology,
} from "./agent.ts";

afterEach(() => {
  installMemoriesServiceFetch(undefined);
});

describe("agentMemoriesDatabase", () => {
  test("builds an account database id from agent did", () => {
    expect(agentMemoriesDatabase("did:key:abc")).toEqual({
      kind: "account",
      ownerKey: "did:key:abc",
    });
  });
});

describe("resolveAgentMemoriesOntology", () => {
  test("merges app ontology onto Memory/References baseline", () => {
    const app = defineOntology({
      nodeLabels: {
        Note: z.object({ title: z.string() }),
      },
      edgeLabels: {},
    });
    const merged = resolveAgentMemoriesOntology(app);
    expect(AGENT_MEMORY_NODE_KIND in merged.nodeLabels).toBe(true);
    expect(AGENT_MEMORY_EDGE_KIND in merged.edgeLabels).toBe(true);
    expect("Note" in merged.nodeLabels).toBe(true);
  });

  test("app node kinds win on collision", () => {
    const app = defineOntology({
      nodeLabels: {
        [AGENT_MEMORY_NODE_KIND]: z.object({ custom: z.string() }),
      },
      edgeLabels: {},
    });
    const merged = resolveAgentMemoriesOntology(app);
    expect(merged.nodeLabels[AGENT_MEMORY_NODE_KIND]).toBe(app.nodeLabels[AGENT_MEMORY_NODE_KIND]);
  });
});

describe("installMemoriesServiceFetch", () => {
  test("overrides and clears the installed fetch", () => {
    const custom: typeof fetch = (async () => new Response("ok")) as unknown as typeof fetch;
    installMemoriesServiceFetch(custom);
    expect(memoriesServiceFetch()).toBe(custom);
    installMemoriesServiceFetch(undefined);
    expect(memoriesServiceFetch()).toBe(fetch);
  });
});

describe("createDeferredAgentMemoriesClient", () => {
  test("returns a deferred client bound to the agent database", () => {
    const client = createDeferredAgentMemoriesClient({
      baseUrl: "http://127.0.0.1:9",
      database: agentMemoriesDatabase("did:key:agent"),
      ontology: defineOntology({ nodeLabels: {}, edgeLabels: {} }),
      adminToken: "token",
    });
    expect(client).toBeDefined();
    expect(typeof client.persistence.findMemoryIdByKey).toBe("function");
  });
});
