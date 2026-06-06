import { expect, test } from "bun:test";
import { evaluateComposable } from "@khoralabs/agent-capabilities";
import { toolMapToAiTools } from "@khoralabs/agent-capabilities-ai-sdk";
import type { NamespacePath, SearchParams } from "@khoralabs/memories-core";
import type { EmbeddingModel } from "@khoralabs/memories-core/helpers";
import { memorySearchToolkit } from "./memory-search-toolkit.js";
import { toMemorySearchEnv } from "./toolkit-context.js";

test("memory_search forwards additionalNamespaces to client.search", async () => {
  const embeddingModel = {
    model: "mock-embed-model",
    textBatchSize: 8,
  } as unknown as EmbeddingModel;

  let captured: SearchParams | undefined;

  const env = toMemorySearchEnv({
    client: {
      search(params: SearchParams) {
        captured = params;
        return [];
      },
    } as never,
    namespace: "ns/a",
    additionalNamespaces: ["ns/b", "ns/c"],
    embeddingModel,
  });

  const { tools } = await evaluateComposable(memorySearchToolkit, {
    env,
    namespace: env.namespace,
  });

  const memorySearch = toolMapToAiTools(tools, {
    env,
    namespace: env.namespace,
  }).memory_search;
  if (!memorySearch || typeof memorySearch.execute !== "function") {
    throw new Error("expected memory_search AI tool");
  }

  await memorySearch.execute(
    {
      content: { text: "hello" },
      options: { arms: { lexical: 1, vector: 0 } },
    },
    { toolCallId: "ns-test", messages: [] } as never,
  );

  expect(captured?.namespace).toBe("ns/a");
  expect(captured?.additionalNamespaces).toEqual(["ns/b", "ns/c"] as NamespacePath[]);
});
