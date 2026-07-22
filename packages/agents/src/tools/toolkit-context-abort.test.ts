import { describe, expect, test } from "bun:test";
import { buildMemorySearchToolkitAndRuntime } from "./toolkit-context.js";

describe("buildMemorySearchToolkitAndRuntime abortSignal", () => {
  test("forwards abortSignal to toolkit and runtime contexts", () => {
    const controller = new AbortController();
    const client = {
      persistence: {},
      ontology: { nodeLabels: {}, edgeLabels: {} },
    } as never;
    const embeddingModel = { embed: async () => [0] } as never;

    const { toolkitCtx, runtime } = buildMemorySearchToolkitAndRuntime({
      client,
      namespace: "ns",
      embeddingModel,
      abortSignal: controller.signal,
    });

    expect(toolkitCtx.abortSignal).toBe(controller.signal);
    expect(runtime.abortSignal).toBe(controller.signal);
  });
});
