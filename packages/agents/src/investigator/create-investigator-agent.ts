import type {
  RegisteredAgent,
  RegisteredAgentAffordances,
  ToolRuntimeContext,
} from "@khoralabs/agent-capabilities";
import type { LanguageModel } from "ai";
import {
  buildMemorySearchAgentSpec,
  createMemorySearchToolLoopAgentFromSpec,
  DEFAULT_INVESTIGATOR_MAX_STEPS,
  type MemorySearchAgentRunResult,
  type MemorySearchAgentSpec,
  type MemorySearchEnv,
  type MemorySearchToolLoopAgent,
  type MemorySearchToolSet,
} from "../tools/index";
import {
  type InvestigatorStructuredOutput,
  investigatorAnswerOutput,
} from "./investigator-output.js";

export type MemoryInvestigatorToolSet = MemorySearchToolSet;

export type MemoryInvestigatorAgent = MemorySearchToolLoopAgent<InvestigatorStructuredOutput>;

export type InvestigatorPipelineGeneration = MemorySearchAgentRunResult;

export type BuildMemoryInvestigatorAgentSpecArgs = {
  model: LanguageModel;
  identity: RegisteredAgent;
  affordances: RegisteredAgentAffordances;
  runtime: ToolRuntimeContext<MemorySearchEnv>;
  maxSteps?: number;
};

export function buildMemoryInvestigatorAgentSpec(
  args: BuildMemoryInvestigatorAgentSpecArgs,
): MemorySearchAgentSpec<InvestigatorStructuredOutput> {
  const { model, identity, affordances, runtime, maxSteps = DEFAULT_INVESTIGATOR_MAX_STEPS } = args;
  return buildMemorySearchAgentSpec<InvestigatorStructuredOutput>({
    model,
    identity,
    affordances,
    runtime,
    maxSteps,
    memorySearchBudgetPerStep: true,
    output: investigatorAnswerOutput(),
  });
}

export function createMemoryInvestigatorAgent(
  args: BuildMemoryInvestigatorAgentSpecArgs,
): MemoryInvestigatorAgent {
  return createMemorySearchToolLoopAgentFromSpec(buildMemoryInvestigatorAgentSpec(args));
}
