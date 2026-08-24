import type {
  RegisteredAgent,
  RegisteredAgentAffordances,
  ToolRuntimeContext,
} from "@khoralabs/agent-capabilities";
import type { LabelSchemaMap } from "@khoralabs/memories-node/ontology";
import { type generateObject, type LanguageModel, Output } from "ai";
import z from "zod";
import {
  buildMemorySearchAgentSpec,
  createMemorySearchToolLoopAgent,
  DEFAULT_MEMORY_TOOL_LOOP_MAX_STEPS,
  type MemorySearchAgentSpec,
  type MemorySearchEnv,
  type MemorySearchToolLoopAgent,
  type MemorySearchToolSet,
} from "../tools/index";
import { memoryIntegratorSearchPhaseInstruction } from "./instructions.js";

export type MemoryIntegratorToolSet = MemorySearchToolSet;

const zIntegratorSearchComplete = z.object({
  ready: z.boolean().describe("Set to true when memory_search is complete."),
});

export type IntegratorSearchStructuredOutput = ReturnType<
  typeof createIntegratorSearchCompleteOutput
>;

export type MemoryIntegratorSearchAgent =
  MemorySearchToolLoopAgent<IntegratorSearchStructuredOutput>;

export type IntegratorSearchGeneration = Awaited<
  ReturnType<MemoryIntegratorSearchAgent["generate"]>
>;

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

/** Phase 1: tool loop for memory_search only; accumulates keys in {@link MemorySearchEnv.discoveredMemoryKeys}. */
export function createMemoryIntegratorSearchAgent<
  _TNode extends LabelSchemaMap = LabelSchemaMap,
  _TEdge extends LabelSchemaMap = LabelSchemaMap,
>(args: BuildMemoryIntegratorSearchAgentSpecArgs): MemoryIntegratorSearchAgent {
  const spec = buildMemoryIntegratorSearchAgentSpec(args);
  return createMemorySearchToolLoopAgent<IntegratorSearchStructuredOutput>({
    model: spec.model,
    identity: args.identity,
    affordances: { ...args.affordances, instructions: spec.instructions ?? "" },
    runtime: args.runtime,
    maxSteps: spec.maxSteps,
    memorySearchBudgetPerStep: true,
    output: spec.output,
  });
}
