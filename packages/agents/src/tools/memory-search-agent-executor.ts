import { type ModelMessage, stepCountIs, ToolLoopAgent } from "ai";
import type { MemorySearchAgentSpec, ToolLoopOutputSpec } from "./memory-search-agent-spec.js";

export type MemorySearchAgentRunResult<TOutput = unknown> = {
  output: TOutput;
  /** Agent-produced messages (model + tool turns), excluding the input prompt. */
  messages: ModelMessage[];
  /** For error messages / telemetry; optional for workflow runs. */
  stepCount?: number;
  finishReason?: string;
};

export type MemorySearchAgentExecutor = {
  run<OUTPUT extends ToolLoopOutputSpec>(
    spec: MemorySearchAgentSpec<OUTPUT>,
    opts: { messages: ModelMessage[]; abortSignal?: AbortSignal },
  ): Promise<MemorySearchAgentRunResult>;
};

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

/** Default in-memory executor backed by AI SDK {@link ToolLoopAgent}. */
export const toolLoopMemorySearchExecutor: MemorySearchAgentExecutor = {
  run: async <OUTPUT extends ToolLoopOutputSpec>(
    spec: MemorySearchAgentSpec<OUTPUT>,
    opts: { messages: ModelMessage[]; abortSignal?: AbortSignal },
  ): Promise<MemorySearchAgentRunResult> => {
    const agent = toolLoopAgentFromSpec(spec);
    const generation = await agent.generate(opts);
    return toolLoopGenerationToRunResult(generation);
  },
};
