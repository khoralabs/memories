import { expect, test } from "bun:test";
import type { ModelMessage } from "ai";
import {
  toolLoopGenerationToRunResult,
  toolLoopStepMessages,
} from "./memory-search-agent-executor.js";

test("toolLoopStepMessages flattens step response messages", () => {
  const assistantMsg: ModelMessage = { role: "assistant", content: "hello" };
  const toolMsg: ModelMessage = {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId: "c1",
        toolName: "memory_search",
        output: { type: "json", value: {} },
      },
    ],
  };
  const generation = {
    output: { ok: true },
    finishReason: "stop",
    steps: [{ response: { messages: [assistantMsg] } }, { response: { messages: [toolMsg] } }],
  } as never;

  expect(toolLoopStepMessages(generation)).toEqual([assistantMsg, toolMsg]);
});

test("toolLoopGenerationToRunResult maps output, stepCount, and finishReason", () => {
  const generation = {
    output: { ready: true },
    finishReason: "stop",
    steps: [
      { response: { messages: [{ role: "assistant", content: "done" }] } },
      { response: { messages: [] } },
    ],
  } as never;

  const result = toolLoopGenerationToRunResult<{ ready: boolean }>(generation);
  expect(result.output).toEqual({ ready: true });
  expect(result.stepCount).toBe(2);
  expect(result.finishReason).toBe("stop");
  expect(result.messages).toHaveLength(1);
});
