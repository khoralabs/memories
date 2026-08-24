import { stepCountIs, ToolLoopAgent } from "ai";
import {
  buildMemorySearchAgentSpec,
  type MemorySearchAgentSpec,
  type MemorySearchAgentSpecOptions,
  type MemorySearchToolSet,
  type ToolLoopOutputSpec,
} from "./memory-search-agent-spec.js";

export type { MemorySearchToolSet, ToolLoopOutputSpec };

type ToolLoopRuntimeContext = Record<string, unknown>;

/** {@link ToolLoopAgent} instance for memory-search sessions (AI SDK v7: runtime context + output). */
export type MemorySearchToolLoopAgent<OUTPUT extends ToolLoopOutputSpec = ToolLoopOutputSpec> =
  ToolLoopAgent<never, MemorySearchToolSet, ToolLoopRuntimeContext, OUTPUT>;

/** Construct a {@link ToolLoopAgent} from a pre-built {@link MemorySearchAgentSpec}. */
export function createMemorySearchToolLoopAgentFromSpec<
  OUTPUT extends ToolLoopOutputSpec = ToolLoopOutputSpec,
>(spec: MemorySearchAgentSpec<OUTPUT>): MemorySearchToolLoopAgent<OUTPUT> {
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

/**
 * {@link ToolLoopAgent} for memory-search–backed sessions: same wiring as the memories adapter/integrator agents.
 * {@code OUTPUT} is an AI SDK output spec (e.g. from {@code Output.object(...)}).
 */
export function createMemorySearchToolLoopAgent<
  OUTPUT extends ToolLoopOutputSpec = ToolLoopOutputSpec,
>(args: MemorySearchAgentSpecOptions<OUTPUT>): MemorySearchToolLoopAgent<OUTPUT> {
  return createMemorySearchToolLoopAgentFromSpec(buildMemorySearchAgentSpec(args));
}
