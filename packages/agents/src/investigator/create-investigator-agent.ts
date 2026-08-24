import type {
  RegisteredAgent,
  RegisteredAgentAffordances,
  ToolRuntimeContext,
} from "@khoralabs/agent-capabilities";
import type { LanguageModel } from "ai";
import {
  buildMemorySearchAgentSpec,
  createMemorySearchToolLoopAgent,
  DEFAULT_INVESTIGATOR_MAX_STEPS,
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

export type InvestigatorPipelineGeneration = Awaited<
  ReturnType<MemoryInvestigatorAgent["generate"]>
>;

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
  const spec = buildMemoryInvestigatorAgentSpec(args);
  return createMemorySearchToolLoopAgent({
    model: spec.model,
    identity: args.identity,
    affordances: args.affordances,
    runtime: args.runtime,
    maxSteps: spec.maxSteps,
    memorySearchBudgetPerStep: true,
    output: spec.output,
  });
}
