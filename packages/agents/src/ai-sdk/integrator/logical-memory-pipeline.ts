import { type AgentRegistry, createAgentRegistry } from "@khoralabs/agent-capabilities";
import type { AgentTelemetry } from "@khoralabs/agent-capabilities-otel";
import type { MemoriesClient, MemoriesClientAsync } from "@khoralabs/memories-node";
import {
  decomposeLogicalMemoryToContent,
  type EmbeddingModel,
  type LogicalMemoryInput,
  mergeLogicalMemoryWithMergeSlice,
  type ProcessedLogicalMemory,
} from "@khoralabs/memories-node/helpers";
import type { LabelSchemaMap } from "@khoralabs/memories-node/ontology";
import { filterMergeSliceEdgesToExistingMemories } from "../../integrator/apply-plan.js";
import type { DefineMemoryIntegratorIdentityOptions } from "../../integrator/identity.js";
import type { IntegratorPlanWire } from "../../integrator/integrator-output.js";
import { integratorWireToMergeSlice } from "../../integrator/to-merge-slice.js";
import { DEFAULT_MEMORY_TOOL_LOOP_MAX_STEPS } from "../../tools/memory-agent-defaults.js";
import { MemoryIntegratorClient } from "./client.js";
import type { IntegratorPipelineGeneration } from "./create-integrator-agent.js";

function buildIntegratorContent(processed: ProcessedLogicalMemory): string {
  if (processed.plaintext?.trim()) {
    return processed.plaintext.trim();
  }
  const parts = processed.content
    .map((c) => c.text)
    .filter((t): t is string => typeof t === "string" && t.length > 0);
  if (parts.length === 0) {
    throw new Error("integrator: no text in logical memory content to integrate");
  }
  return parts.join("\n\n");
}

const DEFAULT_MULTIMODAL = false;

/**
 * Decompose → {@link MemoryIntegratorClient} (search + structured plan) → merge + search-meta vectors.
 * Host supplies chat/embedding models (CLI wires Gemini; demos may reuse the same).
 */
export async function processLogicalMemoryWithIntegrator<
  TNode extends LabelSchemaMap,
  TEdge extends LabelSchemaMap,
>(args: {
  client: MemoriesClient<TNode, TEdge> | MemoriesClientAsync<TNode, TEdge>;
  logicalMemory: LogicalMemoryInput;
  chatModel: string;
  embeddingModel: EmbeddingModel;
  maxSteps?: number;
  multimodal?: boolean;
  /** Defaults to `{ app: "cfd-cli" }` identity when omitted. */
  integratorClient?: MemoryIntegratorClient<TNode, TEdge>;
  integratorClientOptions?: DefineMemoryIntegratorIdentityOptions;
  /**
   * When {@link integratorClient} is built internally, use this registry (e.g. shared with adapter).
   */
  registry?: AgentRegistry;
  /** Caps {@code memory_search} per integrator run when set. */
  memorySearchBudgetMax?: number;
  telemetry?: AgentTelemetry;
  signal?: AbortSignal;
}): Promise<{
  processedLogicalMemory: ProcessedLogicalMemory;
  plan: IntegratorPlanWire;
  generation: IntegratorPipelineGeneration;
}> {
  const {
    client,
    logicalMemory,
    chatModel,
    embeddingModel,
    maxSteps = DEFAULT_MEMORY_TOOL_LOOP_MAX_STEPS,
    multimodal = DEFAULT_MULTIMODAL,
  } = args;

  const processedContent = await decomposeLogicalMemoryToContent({
    ...logicalMemory,
    embedding: { embeddingModel, multimodal },
  });
  const processedLogicalMemory: ProcessedLogicalMemory = {
    ...logicalMemory,
    content: processedContent,
  };

  const content = buildIntegratorContent(processedLogicalMemory);

  const integratorClient =
    args.integratorClient ??
    new MemoryIntegratorClient({
      identityContext: args.integratorClientOptions?.identityContext ?? { app: "cfd-cli" },
      ...(args.integratorClientOptions?.instructions !== undefined
        ? { instructions: args.integratorClientOptions.instructions }
        : {}),
      registry: args.registry ?? createAgentRegistry(),
      namespace: logicalMemory.namespace,
      model: chatModel,
      client,
      embeddingModel,
    });

  const { plan, generation } = await integratorClient.integrate({
    content,
    maxSteps,
    ...(args.memorySearchBudgetMax !== undefined
      ? { memorySearchBudgetMax: args.memorySearchBudgetMax }
      : {}),
    ...(args.telemetry !== undefined ? { telemetry: args.telemetry } : {}),
    ...(args.signal !== undefined ? { signal: args.signal } : {}),
  });

  const slice = integratorWireToMergeSlice(client.ontology, plan);
  const filteredSlice = await filterMergeSliceEdgesToExistingMemories(
    client,
    processedLogicalMemory.namespace,
    slice,
  );
  await mergeLogicalMemoryWithMergeSlice(
    client,
    processedLogicalMemory,
    filteredSlice,
    embeddingModel,
  );

  return { processedLogicalMemory, plan, generation };
}
