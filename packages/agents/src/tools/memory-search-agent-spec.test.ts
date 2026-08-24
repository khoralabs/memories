import { expect, test } from "bun:test";
import { evaluateComposable } from "@khoralabs/agent-capabilities";
import type { EmbeddingModel } from "@khoralabs/memories-node/helpers";
import { Output } from "ai";
import z from "zod";
import {
  buildMemorySearchAgentSpec,
  buildMemorySearchBudgetPrepareStep,
  buildMemorySearchTools,
} from "./memory-search-agent-spec.js";
import { memorySearchToolkit } from "./memory-search-toolkit.js";
import { toMemorySearchEnv } from "./toolkit-context.js";

const mockEmbeddingModel = {
  model: "mock-embed-model",
  textBatchSize: 8,
} as unknown as EmbeddingModel;

test("buildMemorySearchAgentSpec wires tools, instructions, and maxSteps", async () => {
  const env = toMemorySearchEnv({
    client: {
      async search() {
        return { hits: [] };
      },
    } as never,
    namespace: "ns",
    embeddingModel: mockEmbeddingModel,
  });
  const { tools } = await evaluateComposable(memorySearchToolkit, {
    env,
    namespace: env.namespace,
  });
  const runtime = { env, namespace: env.namespace };
  const output = Output.object({
    name: "TestOut",
    schema: z.object({ ok: z.boolean() }),
  });
  const spec = buildMemorySearchAgentSpec({
    model: { modelId: "mock", provider: "mock" } as never,
    identity: { agentId: "test-agent", staticHash: "abc" } as never,
    affordances: {
      tools,
      instructions: "  do search  ",
    },
    runtime,
    maxSteps: 5,
    output,
  });

  expect(spec.id).toBe("test-agent");
  expect(spec.maxSteps).toBe(5);
  expect(spec.instructions).toBe("do search");
  expect(spec.tools.memory_search).toBeDefined();
  expect(spec.prepareStep).toBeUndefined();
});

test("buildMemorySearchBudgetPrepareStep resets budget used when enabled", () => {
  const env = toMemorySearchEnv({
    client: {
      async search() {
        return { hits: [] };
      },
    } as never,
    namespace: "ns",
    embeddingModel: mockEmbeddingModel,
    memorySearchBudgetMax: 3,
  });
  const budget = env.memorySearchBudget;
  if (budget === undefined) {
    throw new Error("expected memorySearchBudget");
  }
  budget.used = 2;
  const runtime = { env, namespace: env.namespace };
  const prepareStep = buildMemorySearchBudgetPrepareStep(runtime, true);
  expect(prepareStep).toBeDefined();
  if (prepareStep === undefined) {
    throw new Error("expected prepareStep");
  }
  prepareStep({} as never);
  expect(budget.used).toBe(0);
});

test("buildMemorySearchTools matches toolMapToAiTools for memory_search toolkit", async () => {
  const env = toMemorySearchEnv({
    client: {
      async search() {
        return { hits: [] };
      },
    } as never,
    namespace: "ns",
    embeddingModel: mockEmbeddingModel,
  });
  const { tools } = await evaluateComposable(memorySearchToolkit, {
    env,
    namespace: env.namespace,
  });
  const runtime = { env, namespace: env.namespace };
  const aiTools = buildMemorySearchTools({ tools, instructions: "" }, runtime);
  expect(Object.keys(aiTools)).toContain("memory_search");
});
