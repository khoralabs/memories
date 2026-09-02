import type {
  RegisteredAgent,
  RegisteredAgentAffordances,
  ToolRuntimeContext,
} from "@khoralabs/agent-capabilities";
import { toolMapToAiTools } from "@khoralabs/agent-capabilities-ai-sdk";
import type { LanguageModel, Tool, ToolLoopAgent, ToolSet } from "ai";
import { DEFAULT_MEMORY_TOOL_LOOP_MAX_STEPS } from "../tools/memory-agent-defaults.js";
import type { MemorySearchEnv } from "../tools/memory-search-toolkit.js";

/** Tool map shape used by memory-search agents (aligns with adapter/integrator {@code *ToolSet} aliases). */
export type MemorySearchToolSet = Record<string, Tool<unknown, unknown>> & ToolSet;

type ToolLoopOutputSpec = NonNullable<ConstructorParameters<typeof ToolLoopAgent>[0]["output"]>;
type ToolLoopPrepareStep = NonNullable<
  ConstructorParameters<typeof ToolLoopAgent>[0]["prepareStep"]
>;

/** Runner-agnostic memory-search agent configuration (model, tools, instructions, output). */
export type MemorySearchAgentSpec<OUTPUT extends ToolLoopOutputSpec = ToolLoopOutputSpec> = {
  id: string;
  model: LanguageModel;
  tools: MemorySearchToolSet;
  instructions?: string;
  prepareStep?: ToolLoopPrepareStep;
  output: OUTPUT;
  maxSteps: number;
};

/** Options for {@link buildMemorySearchAgentSpec} and {@link createMemorySearchToolLoopAgent}. */
export type MemorySearchAgentSpecOptions<OUTPUT extends ToolLoopOutputSpec = ToolLoopOutputSpec> = {
  model: LanguageModel;
  identity: RegisteredAgent;
  affordances: RegisteredAgentAffordances;
  runtime: ToolRuntimeContext<MemorySearchEnv>;
  maxSteps?: number;
  memorySearchBudgetPerStep?: boolean;
  output: OUTPUT;
};

/** Map registered affordances to AI SDK tools for memory-search sessions. */
export function buildMemorySearchTools(
  affordances: RegisteredAgentAffordances,
  runtime: ToolRuntimeContext<MemorySearchEnv>,
): MemorySearchToolSet {
  return toolMapToAiTools(affordances.tools, runtime) as MemorySearchToolSet;
}

/**
 * When enabled and {@code runtime.env.memorySearchBudget} is set, zero {@code used} before each LLM step.
 */
export function buildMemorySearchBudgetPrepareStep(
  runtime: ToolRuntimeContext<MemorySearchEnv>,
  enabled = false,
): ToolLoopPrepareStep | undefined {
  if (!enabled || runtime.env.memorySearchBudget === undefined) {
    return undefined;
  }
  return () => {
    const b = runtime.env.memorySearchBudget;
    if (b !== undefined) b.used = 0;
    return {};
  };
}

/** Build runner-agnostic spec shared by ToolLoop and custom executors (e.g. WorkflowAgent). */
export function buildMemorySearchAgentSpec<OUTPUT extends ToolLoopOutputSpec>(
  args: MemorySearchAgentSpecOptions<OUTPUT>,
): MemorySearchAgentSpec<OUTPUT> {
  const {
    model,
    identity,
    affordances,
    runtime,
    maxSteps = DEFAULT_MEMORY_TOOL_LOOP_MAX_STEPS,
    memorySearchBudgetPerStep = false,
    output,
  } = args;
  const tools = buildMemorySearchTools(affordances, runtime);
  const inst = affordances.instructions.trim();
  const prepareStep = buildMemorySearchBudgetPrepareStep(runtime, memorySearchBudgetPerStep);
  return {
    id: identity.agentId,
    model,
    tools,
    ...(inst ? { instructions: inst } : {}),
    ...(prepareStep !== undefined ? { prepareStep } : {}),
    output,
    maxSteps,
  };
}

export type { ToolLoopOutputSpec };
