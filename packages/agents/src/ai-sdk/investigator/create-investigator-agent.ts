import type {
  RegisteredAgent,
  RegisteredAgentAffordances,
  ToolRuntimeContext,
} from "@khoralabs/agent-capabilities";
import type { LanguageModel } from "ai";
import { DEFAULT_INVESTIGATOR_MAX_STEPS } from "../../tools/memory-agent-defaults.js";
import type { MemorySearchAgentRunResult } from "../../tools/memory-search-agent-executor.js";
import type { MemorySearchEnv } from "../../tools/memory-search-toolkit.js";
import {
  buildMemorySearchAgentSpec,
  type MemorySearchAgentSpec,
  type MemorySearchToolSet,
} from "../memory-search-agent-spec.js";
import { type InvestigatorStructuredOutput, investigatorAnswerOutput } from "../output.js";
import {
  createMemorySearchToolLoopAgentFromSpec,
  type MemorySearchToolLoopAgent,
} from "../tool-loop-from-affordances.js";

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
