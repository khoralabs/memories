import type {
  RegisteredAgent,
  RegisteredAgentAffordances,
  ToolRuntimeContext,
} from "@khoralabs/agent-capabilities";
import type { LabelSchemaMap, OntologyDefinition } from "@khoralabs/memories-node/ontology";
import type { LanguageModel } from "ai";
import {
  buildMemorySearchAgentSpec,
  createMemorySearchToolLoopAgent,
  DEFAULT_MEMORY_TOOL_LOOP_MAX_STEPS,
  type MemorySearchAgentSpec,
  type MemorySearchEnv,
  type MemorySearchToolLoopAgent,
  type MemorySearchToolSet,
} from "../tools/index";
import {
  type MemoryAdapterStructuredOutput,
  memoryAdapterExpandedOutput,
} from "./adapter-output.js";

/** AI SDK tool map for the memory adapter (search only). */
export type MemoryAdapterToolSet = MemorySearchToolSet;

export type MemoryAdapterAgent = MemorySearchToolLoopAgent<MemoryAdapterStructuredOutput>;

export type AdapterPipelineGeneration = Awaited<ReturnType<MemoryAdapterAgent["generate"]>>;

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
  const spec = buildMemoryAdapterAgentSpec(args);
  return createMemorySearchToolLoopAgent({
    model: spec.model,
    identity: args.identity,
    affordances: args.affordances,
    runtime: args.runtime,
    maxSteps: spec.maxSteps,
    output: spec.output,
  });
}
