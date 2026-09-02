import type {
  RegisteredAgent,
  RegisteredAgentAffordances,
  ToolRuntimeContext,
} from "@khoralabs/agent-capabilities";
import type { LabelSchemaMap, OntologyDefinition } from "@khoralabs/memories-node/ontology";
import type { LanguageModel } from "ai";
import { DEFAULT_MEMORY_TOOL_LOOP_MAX_STEPS, type MemorySearchEnv } from "../../tools/index.js";
import type { MemorySearchAgentRunResult } from "../../tools/memory-search-agent-executor.js";
import {
  buildMemorySearchAgentSpec,
  type MemorySearchAgentSpec,
  type MemorySearchToolSet,
} from "../memory-search-agent-spec.js";
import { type MemoryAdapterStructuredOutput, memoryAdapterExpandedOutput } from "../output.js";
import {
  createMemorySearchToolLoopAgentFromSpec,
  type MemorySearchToolLoopAgent,
} from "../tool-loop-from-affordances.js";

/** AI SDK tool map for the memory adapter (search only). */
export type MemoryAdapterToolSet = MemorySearchToolSet;

export type MemoryAdapterAgent = MemorySearchToolLoopAgent<MemoryAdapterStructuredOutput>;

export type AdapterPipelineGeneration = MemorySearchAgentRunResult;

export type BuildMemoryAdapterAgentSpecArgs<
  TNode extends LabelSchemaMap,
  TEdge extends LabelSchemaMap,
> = {
  model: LanguageModel;
  identity: RegisteredAgent;
  affordances: RegisteredAgentAffordances;
  runtime: ToolRuntimeContext<MemorySearchEnv>;
  ontology: OntologyDefinition<TNode, TEdge>;
  maxSteps?: number;
};

export function buildMemoryAdapterAgentSpec<
  TNode extends LabelSchemaMap,
  TEdge extends LabelSchemaMap,
>(
  args: BuildMemoryAdapterAgentSpecArgs<TNode, TEdge>,
): MemorySearchAgentSpec<MemoryAdapterStructuredOutput> {
  const {
    model,
    identity,
    affordances,
    runtime,
    ontology,
    maxSteps = DEFAULT_MEMORY_TOOL_LOOP_MAX_STEPS,
  } = args;
  return buildMemorySearchAgentSpec<MemoryAdapterStructuredOutput>({
    model,
    identity,
    affordances,
    runtime,
    maxSteps,
    output: memoryAdapterExpandedOutput(ontology),
  });
}

export function createMemoryAdapterAgent<
  TNode extends LabelSchemaMap,
  TEdge extends LabelSchemaMap,
>(args: BuildMemoryAdapterAgentSpecArgs<TNode, TEdge>): MemoryAdapterAgent {
  return createMemorySearchToolLoopAgentFromSpec(buildMemoryAdapterAgentSpec(args));
}
