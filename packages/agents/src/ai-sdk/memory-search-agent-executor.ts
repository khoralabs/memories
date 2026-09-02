import { type ModelMessage, stepCountIs, ToolLoopAgent } from "ai";
import type {
  MemorySearchAgentExecutor,
  MemorySearchAgentMessage,
  MemorySearchAgentRunResult,
} from "../tools/memory-search-agent-executor.js";
import type { MemorySearchAgentSpec, ToolLoopOutputSpec } from "./memory-search-agent-spec.js";

export type {
  MemorySearchAgentExecutor,
  MemorySearchAgentMessage,
  MemorySearchAgentRunResult,
} from "../tools/memory-search-agent-executor.js";

type ToolLoopGenerateResult = {
  output: unknown;
  finishReason: string | undefined;
  steps: ReadonlyArray<{ response: { messages: ModelMessage[] } }>;
};

/** Flatten step response messages from a ToolLoop generate result. */
export function toolLoopStepMessages(generation: ToolLoopGenerateResult): ModelMessage[] {
  return generation.steps.flatMap((step) => step.response?.messages ?? []);
}

/** Map ToolLoop generate output to {@link MemorySearchAgentRunResult}. */
export function toolLoopGenerationToRunResult(
  generation: ToolLoopGenerateResult,
): MemorySearchAgentRunResult {
  return {
    output: generation.output,
    messages: toolLoopStepMessages(generation),
    stepCount: generation.steps.length,
    finishReason: generation.finishReason,
  };
}

function toolLoopAgentFromSpec<OUTPUT extends ToolLoopOutputSpec>(
  spec: MemorySearchAgentSpec<OUTPUT>,
): ToolLoopAgent<never, MemorySearchAgentSpec<OUTPUT>["tools"], Record<string, unknown>, OUTPUT> {
  return new ToolLoopAgent({
    id: spec.id,
    model: spec.model,
    tools: spec.tools,
    ...(spec.instructions !== undefined ? { instructions: spec.instructions } : {}),
    stopWhen: stepCountIs(spec.maxSteps),
    ...(spec.prepareStep !== undefined ? { prepareStep: spec.prepareStep } : {}),
    output: spec.output,
  });
}

function asModelMessages(messages: MemorySearchAgentMessage[]): ModelMessage[] {
  return messages as ModelMessage[];
}

/**
 * Default in-memory executor backed by AI SDK {@link ToolLoopAgent}.
 * Spec must be a {@link MemorySearchAgentSpec} (passed as {@code unknown} at the core port).
 */
export const toolLoopMemorySearchExecutor: MemorySearchAgentExecutor = {
  run: async (spec, opts): Promise<MemorySearchAgentRunResult> => {
    const agent = toolLoopAgentFromSpec(spec as MemorySearchAgentSpec<ToolLoopOutputSpec>);
    const generation = await agent.generate({
      messages: asModelMessages(opts.messages),
      ...(opts.abortSignal !== undefined ? { abortSignal: opts.abortSignal } : {}),
    });
    return toolLoopGenerationToRunResult(generation);
  },
};
