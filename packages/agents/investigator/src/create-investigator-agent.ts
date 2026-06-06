import type {
  RegisteredAgent,
  RegisteredAgentAffordances,
  ToolRuntimeContext,
} from "@khoralabs/agent-capabilities";
import {
  createMemorySearchToolLoopAgent,
  DEFAULT_INVESTIGATOR_MAX_STEPS,
  type MemorySearchEnv,
  type MemorySearchToolSet,
} from "@khoralabs/memories-tools";
import type { LanguageModel, ToolLoopAgent } from "ai";
import {
  type InvestigatorStructuredOutput,
  investigatorAnswerOutput,
} from "./investigator-output.js";

export type MemoryInvestigatorToolSet = MemorySearchToolSet;

export type MemoryInvestigatorAgent = ToolLoopAgent<
  never,
  MemoryInvestigatorToolSet,
  InvestigatorStructuredOutput
>;

export type InvestigatorPipelineGeneration = Awaited<
  ReturnType<MemoryInvestigatorAgent["generate"]>
>;

export function createMemoryInvestigatorAgent(args: {
  model: LanguageModel;
  identity: RegisteredAgent;
  affordances: RegisteredAgentAffordances;
  runtime: ToolRuntimeContext<MemorySearchEnv>;
  maxSteps?: number;
}): MemoryInvestigatorAgent {
  const { model, identity, affordances, runtime, maxSteps = DEFAULT_INVESTIGATOR_MAX_STEPS } = args;
  const output = investigatorAnswerOutput();
  return createMemorySearchToolLoopAgent<InvestigatorStructuredOutput>({
    model,
    identity,
    affordances,
    runtime,
    maxSteps,
    memorySearchBudgetPerStep: true,
    output,
  });
}
