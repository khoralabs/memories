import { type AgentRegistry, createAgentRegistry } from "@khoralabs/agent-capabilities";
import type { AgentTelemetry } from "@khoralabs/agent-capabilities-otel";
import type {
  MemoriesClient,
  MemoriesClientAsync,
  MergeMemoryParamsNode,
} from "@khoralabs/memories-node";
import {
  decomposeLogicalMemoryToContent,
  type EmbeddingModel,
  type LogicalMemoryInput,
  mergeLogicalMemoryWithMergeSlice,
  type ProcessedLogicalMemory,
} from "@khoralabs/memories-node/helpers";
import type { LabelSchemaMap } from "@khoralabs/memories-node/ontology";
import type { LanguageModel } from "ai";
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

type PersistenceWithFindKey = {
  findMemoryIdByKey(
    namespace: string,
    key: string,
  ): string | undefined | Promise<string | undefined>;
};

async function resolveFindMemoryIdByKey(
  persistence: PersistenceWithFindKey,
  namespace: string,
  key: string,
): Promise<string | undefined> {
  const r = persistence.findMemoryIdByKey(namespace, key);
  return r instanceof Promise ? await r : r;
}

/**
 * Drops integrator edges whose peer is not an existing memory in `namespace`, and rewrites
 * `peer_memory_id` from memory key → resolved `_id` (merge expects ids, not keys).
 */
async function filterMergeSliceEdgesToExistingMemories<
  TNode extends LabelSchemaMap,
  TEdge extends LabelSchemaMap,
>(
  client: MemoriesClient<TNode, TEdge> | MemoriesClientAsync<TNode, TEdge>,
  namespace: string,
  slice: Pick<MergeMemoryParamsNode<TNode, TEdge>, "labels" | "edges" | "properties">,
): Promise<Pick<MergeMemoryParamsNode<TNode, TEdge>, "labels" | "edges" | "properties">> {
  if (slice.edges === undefined || slice.edges.length === 0) {
    return slice;
  }
  const kept: NonNullable<MergeMemoryParamsNode<TNode, TEdge>["edges"]> = [];
  for (const e of slice.edges) {
    const id = await resolveFindMemoryIdByKey(client.persistence, namespace, e.peer_memory_id);
    if (id !== undefined) {
      kept.push({ ...e, peer_memory_id: id });
    }
  }
  return {
    ...slice,
    edges: kept.length > 0 ? kept : undefined,
  };
}

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
  chatModel: LanguageModel;
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
