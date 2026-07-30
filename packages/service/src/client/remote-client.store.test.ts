import { describe, expect, test } from "bun:test";
import type { Store } from "@khoralabs/memories-node";
import type { LabelSchemaMap, OntologyDefinition } from "@khoralabs/memories-node/ontology";
import { DEFAULT_SQLITE_STRATEGY_CAPABILITIES } from "../storage/core/backend";
import { RemoteMemoriesClientAsync } from "./remote-client";

const ontology: OntologyDefinition<LabelSchemaMap, LabelSchemaMap> = {
  nodeLabels: {},
  edgeLabels: {},
};

const baseOpts = {
  baseUrl: "http://127.0.0.1:9",
  database: { kind: "account" as const, ownerKey: "store-forward" },
  ontology,
};

describe("RemoteMemoriesClientAsync store options", () => {
  test("without store, resolveSourcesForMemory requires store", async () => {
    const client = new RemoteMemoriesClientAsync(baseOpts, DEFAULT_SQLITE_STRATEGY_CAPABILITIES);
    await expect(client.resolveSourcesForMemory("ns", "mid", 1)).rejects.toThrow(
      /pass store or storeForNamespace/,
    );
  });

  test("with store, resolveSourcesForMemory uses that store (not the missing-store error)", async () => {
    const store = {
      async resolve() {
        return { kind: "text", text: "" };
      },
    } as unknown as Store;
    const client = new RemoteMemoriesClientAsync(
      { ...baseOpts, store },
      DEFAULT_SQLITE_STRATEGY_CAPABILITIES,
    );
    let message = "";
    try {
      await client.resolveSourcesForMemory("ns", "mid", 1);
    } catch (cause) {
      message = cause instanceof Error ? cause.message : String(cause);
    }
    expect(message).not.toMatch(/pass store or storeForNamespace/);
  });
});
