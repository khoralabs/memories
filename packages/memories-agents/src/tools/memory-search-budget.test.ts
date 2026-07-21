import { expect, test } from "bun:test";
import { evaluateComposable } from "@khoralabs/agent-capabilities";
import { toolMapToAiTools } from "@khoralabs/agent-capabilities-ai-sdk";
import type { EmbeddingModel } from "@khoralabs/memories-node/helpers";
import { memorySearchToolkit } from "./memory-search-toolkit.js";
import { toMemorySearchEnv } from "./toolkit-context.js";

test("memory_search budget denies after max completed searches", async () => {
  const embeddingModel = {
    model: "mock-embed-model",
    textBatchSize: 8,
  } as unknown as EmbeddingModel;

  const env = toMemorySearchEnv({
    client: {
      async search() {
        return [];
      },
    } as never,
    namespace: "ns",
    embeddingModel,
    memorySearchBudgetMax: 2,
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

  const input = {
    content: { text: "one" },
    options: { arms: { lexical: 1, vector: 0 } },
  };

  const toolOpts = { toolCallId: "memory-search-budget-test", messages: [] } as never;

  await memorySearch.execute(input, toolOpts);
  expect(env.memorySearchBudget?.used).toBe(1);

  await memorySearch.execute({ ...input, content: { text: "two" } }, toolOpts);
  expect(env.memorySearchBudget?.used).toBe(2);

  await expect(
    memorySearch.execute({ ...input, content: { text: "three" } }, toolOpts),
  ).rejects.toThrow("Policy denied: memory_search_budget");
});
