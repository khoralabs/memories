import type {
  RegisteredAgent,
  RegisteredAgentAffordances,
  ToolRuntimeContext,
} from "@khoralabs/agent-capabilities";
import type { LabelSchemaMap, OntologyDefinition } from "@khoralabs/memories-ontologies";
import type { LanguageModel } from "ai";
import {
  createMemorySearchToolLoopAgent,
  DEFAULT_MEMORY_TOOL_LOOP_MAX_STEPS,
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

export function createMemoryAdapterAgent<
  TNode extends LabelSchemaMap,
  TEdge extends LabelSchemaMap,
>(args: {
  model: LanguageModel;
  identity: RegisteredAgent;
  affordances: RegisteredAgentAffordances;
  runtime: ToolRuntimeContext<MemorySearchEnv>;
  ontology: OntologyDefinition<TNode, TEdge>;
  maxSteps?: number;
}): MemoryAdapterAgent {
  const {
    model,
    identity,
    affordances,
    runtime,
    ontology,
    maxSteps = DEFAULT_MEMORY_TOOL_LOOP_MAX_STEPS,
  } = args;
  const output = memoryAdapterExpandedOutput(ontology);
  return createMemorySearchToolLoopAgent<MemoryAdapterStructuredOutput>({
    model,
    identity,
    affordances,
    runtime,
    maxSteps,
    output,
  });
}
