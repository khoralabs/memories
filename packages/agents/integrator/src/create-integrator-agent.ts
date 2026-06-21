import type {
  RegisteredAgent,
  RegisteredAgentAffordances,
  ToolRuntimeContext,
} from "@khoralabs/agent-capabilities";
import type { LabelSchemaMap, OntologyDefinition } from "@khoralabs/memories-core";
import {
  createMemorySearchToolLoopAgent,
  DEFAULT_MEMORY_TOOL_LOOP_MAX_STEPS,
  type MemorySearchEnv,
  type MemorySearchToolSet,
} from "@khoralabs/memories-tools";
import { type generateObject, type LanguageModel, Output, type ToolLoopAgent } from "ai";
import z from "zod";
import { memoryIntegratorSearchPhaseInstruction } from "./instructions.js";
import {
  type IntegratorPlanStructuredOutput,
  integratorPlanOutputFromOntology,
} from "./integrator-output.js";

export type MemoryIntegratorToolSet = MemorySearchToolSet;

const zIntegratorSearchComplete = z.object({
  ready: z.literal(true).describe("Set true when memory_search is complete."),
});

export type IntegratorSearchStructuredOutput = ReturnType<
  typeof createIntegratorSearchCompleteOutput
>;

export type MemoryIntegratorSearchAgent = ToolLoopAgent<
  never,
  MemoryIntegratorToolSet,
  IntegratorSearchStructuredOutput
>;

export type MemoryIntegratorAgent = ToolLoopAgent<
  never,
  MemoryIntegratorToolSet,
  IntegratorPlanStructuredOutput
>;

export type IntegratorSearchGeneration = Awaited<
  ReturnType<MemoryIntegratorSearchAgent["generate"]>
>;

export type IntegratorPlanGeneration = Awaited<ReturnType<typeof generateObject>>;

export type IntegratorPipelineGeneration = IntegratorPlanGeneration;

function createIntegratorSearchCompleteOutput() {
  return Output.object({
    name: "MemoryIntegratorSearchComplete",
    description: "Signals that neighbor memory_search is complete.",
    schema: zIntegratorSearchComplete,
  });
}

/** Phase 1: tool loop for memory_search only; accumulates keys in {@link MemorySearchEnv.discoveredMemoryKeys}. */
export function createMemoryIntegratorSearchAgent<
  _TNode extends LabelSchemaMap = LabelSchemaMap,
  _TEdge extends LabelSchemaMap = LabelSchemaMap,
>(args: {
  model: LanguageModel;
  identity: RegisteredAgent;
  affordances: RegisteredAgentAffordances;
  runtime: ToolRuntimeContext<MemorySearchEnv>;
  maxSteps?: number;
}): MemoryIntegratorSearchAgent {
  const {
    model,
    identity,
    affordances,
    runtime,
    maxSteps = DEFAULT_MEMORY_TOOL_LOOP_MAX_STEPS,
  } = args;
  const output = createIntegratorSearchCompleteOutput();
  const searchInstructions = [
    ...(affordances.instructions.trim().length > 0 ? [affordances.instructions.trim()] : []),
    memoryIntegratorSearchPhaseInstruction,
  ].join("\n\n");
  return createMemorySearchToolLoopAgent<IntegratorSearchStructuredOutput>({
    model,
    identity,
    affordances: { ...affordances, instructions: searchInstructions },
    runtime,
    maxSteps,
    memorySearchBudgetPerStep: true,
    output,
  });
}

/** @deprecated Single-phase integrator; use {@link createMemoryIntegratorSearchAgent} + plan phase instead. */
export function createMemoryIntegratorAgent<
  TNode extends LabelSchemaMap = LabelSchemaMap,
  TEdge extends LabelSchemaMap = LabelSchemaMap,
>(args: {
  model: LanguageModel;
  identity: RegisteredAgent;
  affordances: RegisteredAgentAffordances;
  runtime: ToolRuntimeContext<MemorySearchEnv>;
  maxSteps?: number;
  ontology: OntologyDefinition<TNode, TEdge>;
}): MemoryIntegratorAgent {
  const {
    model,
    identity,
    affordances,
    runtime,
    maxSteps = DEFAULT_MEMORY_TOOL_LOOP_MAX_STEPS,
    ontology,
  } = args;
  const output = integratorPlanOutputFromOntology(ontology);
  return createMemorySearchToolLoopAgent<IntegratorPlanStructuredOutput>({
    model,
    identity,
    affordances,
    runtime,
    maxSteps,
    memorySearchBudgetPerStep: true,
    output,
  });
}
