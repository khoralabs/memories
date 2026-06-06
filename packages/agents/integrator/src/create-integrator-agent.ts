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
import type { LanguageModel, ToolLoopAgent } from "ai";
import {
  type IntegratorPlanStructuredOutput,
  integratorPlanOutputFromOntology,
} from "./integrator-output.js";

export type MemoryIntegratorToolSet = MemorySearchToolSet;

export type MemoryIntegratorAgent = ToolLoopAgent<
  never,
  MemoryIntegratorToolSet,
  IntegratorPlanStructuredOutput
>;

export type IntegratorPipelineGeneration = Awaited<ReturnType<MemoryIntegratorAgent["generate"]>>;

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
