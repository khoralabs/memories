import type {
  RegisteredAgent,
  RegisteredAgentAffordances,
  ToolRuntimeContext,
} from "@khoralabs/agent-capabilities";
import type { LabelSchemaMap } from "@khoralabs/memories-node/ontology";
import { type generateObject, type LanguageModel, Output } from "ai";
import z from "zod";
import { memoryIntegratorSearchPhaseInstruction } from "../../integrator/instructions.js";
import { DEFAULT_MEMORY_TOOL_LOOP_MAX_STEPS } from "../../tools/memory-agent-defaults.js";
import type { MemorySearchAgentRunResult } from "../../tools/memory-search-agent-executor.js";
import type { MemorySearchEnv } from "../../tools/memory-search-toolkit.js";
import {
  buildMemorySearchAgentSpec,
  type MemorySearchAgentSpec,
  type MemorySearchToolSet,
} from "../memory-search-agent-spec.js";
import {
  createMemorySearchToolLoopAgentFromSpec,
  type MemorySearchToolLoopAgent,
} from "../tool-loop-from-affordances.js";

export type MemoryIntegratorToolSet = MemorySearchToolSet;

const zIntegratorSearchComplete = z.object({
  ready: z.boolean().describe("Set to true when memory_search is complete."),
});

export type IntegratorSearchStructuredOutput = ReturnType<
  typeof createIntegratorSearchCompleteOutput
>;

export type MemoryIntegratorSearchAgent =
  MemorySearchToolLoopAgent<IntegratorSearchStructuredOutput>;

export type IntegratorSearchGeneration = MemorySearchAgentRunResult;

export type IntegratorPlanGeneration = Awaited<ReturnType<typeof generateObject>>;

export type IntegratorPipelineGeneration = IntegratorPlanGeneration;

function createIntegratorSearchCompleteOutput(): ReturnType<typeof Output.object> {
  return Output.object({
    name: "MemoryIntegratorSearchComplete",
    description: "Signals that neighbor memory_search is complete.",
    schema: zIntegratorSearchComplete,
  });
}

export type BuildMemoryIntegratorSearchAgentSpecArgs = {
  model: LanguageModel;
  identity: RegisteredAgent;
  affordances: RegisteredAgentAffordances;
  runtime: ToolRuntimeContext<MemorySearchEnv>;
  maxSteps?: number;
};

export function buildMemoryIntegratorSearchAgentSpec(
  args: BuildMemoryIntegratorSearchAgentSpecArgs,
): MemorySearchAgentSpec<IntegratorSearchStructuredOutput> {
  const {
    model,
    identity,
    affordances,
    runtime,
    maxSteps = DEFAULT_MEMORY_TOOL_LOOP_MAX_STEPS,
  } = args;
  const searchInstructions = [
    ...(affordances.instructions.trim().length > 0 ? [affordances.instructions.trim()] : []),
    memoryIntegratorSearchPhaseInstruction,
  ].join("\n\n");
  return buildMemorySearchAgentSpec<IntegratorSearchStructuredOutput>({
    model,
    identity,
    affordances: { ...affordances, instructions: searchInstructions },
    runtime,
    maxSteps,
    memorySearchBudgetPerStep: true,
    output: createIntegratorSearchCompleteOutput(),
  });
}

export function createMemoryIntegratorSearchAgent<
  _TNode extends LabelSchemaMap = LabelSchemaMap,
  _TEdge extends LabelSchemaMap = LabelSchemaMap,
>(args: BuildMemoryIntegratorSearchAgentSpecArgs): MemoryIntegratorSearchAgent {
  return createMemorySearchToolLoopAgentFromSpec(buildMemoryIntegratorSearchAgentSpec(args));
}
