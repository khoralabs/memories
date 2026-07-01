import type {
  RegisteredAgent,
  RegisteredAgentAffordances,
  ToolRuntimeContext,
} from "@khoralabs/agent-capabilities";
import { toolMapToAiTools } from "@khoralabs/agent-capabilities-ai-sdk";
import { type LanguageModel, stepCountIs, type Tool, ToolLoopAgent, type ToolSet } from "ai";
import { DEFAULT_MEMORY_TOOL_LOOP_MAX_STEPS } from "./memory-agent-defaults.js";
import type { MemorySearchEnv } from "./memory-search-toolkit.js";

/** Tool map shape used by {@link createMemorySearchToolLoopAgent} (aligns with adapter/integrator {@code *ToolSet} aliases). */
export type MemorySearchToolSet = Record<string, Tool<unknown, unknown>> & ToolSet;
type ToolLoopOutputSpec = NonNullable<ConstructorParameters<typeof ToolLoopAgent>[0]["output"]>;
type ToolLoopRuntimeContext = Record<string, unknown>;

/** {@link ToolLoopAgent} instance for memory-search sessions (AI SDK v7: runtime context + output). */
export type MemorySearchToolLoopAgent<OUTPUT extends ToolLoopOutputSpec = ToolLoopOutputSpec> =
  ToolLoopAgent<never, MemorySearchToolSet, ToolLoopRuntimeContext, OUTPUT>;
/**
 * {@link ToolLoopAgent} for memory-search–backed sessions: same wiring as the memories adapter/integrator agents.
 * {@code OUTPUT} is an AI SDK output spec (e.g. from {@code Output.object(...)}).
 */
export function createMemorySearchToolLoopAgent<
  OUTPUT extends ToolLoopOutputSpec = ToolLoopOutputSpec,
>(args: {
  model: LanguageModel;
  identity: RegisteredAgent;
  affordances: RegisteredAgentAffordances;
  runtime: ToolRuntimeContext<MemorySearchEnv>;
  maxSteps?: number;
  /** When true and a memory search budget is set on {@code runtime.env}, zero {@code used} before each LLM step. */
  memorySearchBudgetPerStep?: boolean;
  output: OUTPUT;
}): MemorySearchToolLoopAgent<OUTPUT> {
  const {
    model,
    identity,
    affordances,
    runtime,
    maxSteps = DEFAULT_MEMORY_TOOL_LOOP_MAX_STEPS,
    memorySearchBudgetPerStep = false,
    output,
  } = args;
  const tools = toolMapToAiTools(affordances.tools, runtime) as MemorySearchToolSet;
  const inst = affordances.instructions.trim();
  const prepareStep =
    memorySearchBudgetPerStep && runtime.env.memorySearchBudget !== undefined
      ? () => {
          const b = runtime.env.memorySearchBudget;
          if (b !== undefined) b.used = 0;
          return {};
        }
      : undefined;
  return new ToolLoopAgent({
    id: identity.agentId,
    model,
    tools,
    ...(inst ? { instructions: inst } : {}),
    stopWhen: stepCountIs(maxSteps),
    ...(prepareStep !== undefined ? { prepareStep } : {}),
    output,
  });
}
