import {
  evaluateRegisteredAgentAffordances,
  type RegisteredAgent,
  type RegisteredAgentAffordances,
  type ToolkitContext,
  type ToolRuntimeContext,
} from "@khoralabs/agent-capabilities";
import type { MemoriesClient, MemoriesClientAsync } from "@khoralabs/memories-core";
import type {
  EmbeddingModel,
  HybridMemorySearchWideClient,
  HybridMemorySearchWideClientAsync,
} from "@khoralabs/memories-core/helpers";
import type z from "zod";
import type { MemorySearchEnv } from "./memory-search-toolkit.js";

/** Zod object shape for a label map (node or edge) in session typing. */
export type ZodLabelMap = Record<string, z.ZodType>;

/**
 * Shared fields for memory-search session context: toolkit, runtime, and evaluated affordances.
 * Agents extend this with their own {@link @khoralabs/agent-capabilities!SessionContext} + model, etc.
 */
export type MemorySearchSessionContextSlice<
  TNode extends ZodLabelMap = ZodLabelMap,
  TEdge extends ZodLabelMap = ZodLabelMap,
> = {
  client: MemoriesClient<TNode, TEdge> | MemoriesClientAsync<TNode, TEdge>;
  namespace: string;
  /** Merged with {@link namespace} for `memory_search` (optional). */
  additionalNamespaces?: readonly string[];
  /** Passed through to {@link MemorySearchEnv.memorySearchExtensions} for domain tools. */
  memorySearchExtensions?: Record<string, unknown>;
  embeddingModel: EmbeddingModel;
  agentId?: string;
  agentName?: string;
  memorySearchBudgetMax?: number;
  /**
   * When set (including `""` for an empty provenance chain), forwarded into {@link MemorySearchEnv.memoriesSnapshotRootHex}.
   * {@link attachMemorySearchSessionLayer} sets this from {@link MemoriesPersistence.getProvenanceHeadRootHex}.
   */
  memoriesSnapshotRootHex?: string;
  /** Set by {@link @khoralabs/agent-capabilities!createAgentRegistry} when {@code signal} is configured. */
  abortSignal?: AbortSignal;
  toolkitCtx?: ToolkitContext<MemorySearchEnv>;
  runtime?: ToolRuntimeContext<MemorySearchEnv>;
  affordances?: RegisteredAgentAffordances;
};

export async function getMemoriesProvenanceHeadRootHex(client: {
  persistence: {
    getProvenanceHeadRootHex?: () => string | undefined | Promise<string | undefined>;
  };
}): Promise<string | undefined> {
  const fn = client.persistence.getProvenanceHeadRootHex;
  if (fn === undefined) return undefined;
  const out = fn.call(client.persistence);
  return (await Promise.resolve(out)) as string | undefined;
}

function memorySearchContextBuildArgs<TNode extends ZodLabelMap, TEdge extends ZodLabelMap>(
  context: MemorySearchSessionContextSlice<TNode, TEdge>,
) {
  return {
    client: context.client,
    namespace: context.namespace,
    embeddingModel: context.embeddingModel,
    agentId: context.agentId,
    agentName: context.agentName,
    ...(context.memorySearchBudgetMax !== undefined
      ? { memorySearchBudgetMax: context.memorySearchBudgetMax }
      : {}),
    ...(context.additionalNamespaces !== undefined
      ? { additionalNamespaces: context.additionalNamespaces }
      : {}),
    ...(context.memorySearchExtensions !== undefined
      ? { memorySearchExtensions: context.memorySearchExtensions }
      : {}),
    ...(context.memoriesSnapshotRootHex !== undefined
      ? { memoriesSnapshotRootHex: context.memoriesSnapshotRootHex }
      : {}),
    ...(context.abortSignal !== undefined ? { abortSignal: context.abortSignal } : {}),
  };
}

/**
 * Returns both {@link buildMemorySearchToolkitContext} and {@link buildMemorySearchToolRuntimeContext} for the same inputs.
 */
export function buildMemorySearchToolkitAndRuntime<
  TNode extends ZodLabelMap,
  TEdge extends ZodLabelMap,
>(args: {
  client: MemoriesClient<TNode, TEdge> | MemoriesClientAsync<TNode, TEdge>;
  namespace: string;
  additionalNamespaces?: readonly string[];
  memorySearchExtensions?: Record<string, unknown>;
  embeddingModel: EmbeddingModel;
  agentId?: string;
  agentName?: string;
  memorySearchBudgetMax?: number;
  memoriesSnapshotRootHex?: string;
  abortSignal?: AbortSignal;
}): { toolkitCtx: ToolkitContext<MemorySearchEnv>; runtime: ToolRuntimeContext<MemorySearchEnv> } {
  return {
    toolkitCtx: buildMemorySearchToolkitContext(args),
    runtime: buildMemorySearchToolRuntimeContext(args),
  };
}

/**
 * Sets {@code toolkitCtx}, {@code runtime}, and {@code affordances} on session context (for {@code onAfterContext}).
 * Generics line up with ontology-scoped session types (e.g. {@code MemorySearchSessionContextSlice}{@code <TNode, TEdge>})
 * so callers do not need to widen to {@code ZodLabelMap}.
 */
export async function attachMemorySearchSessionLayer<
  TNode extends ZodLabelMap,
  TEdge extends ZodLabelMap,
>(args: {
  agent: RegisteredAgent;
  context: MemorySearchSessionContextSlice<TNode, TEdge>;
}): Promise<void> {
  const { agent, context: ctx } = args;
  ctx.memoriesSnapshotRootHex =
    ctx.memoriesSnapshotRootHex ?? (await getMemoriesProvenanceHeadRootHex(ctx.client)) ?? "";
  const shared = memorySearchContextBuildArgs<TNode, TEdge>(ctx);
  const { toolkitCtx, runtime } = buildMemorySearchToolkitAndRuntime(shared);
  ctx.toolkitCtx = toolkitCtx;
  ctx.runtime = runtime;
  ctx.affordances = await evaluateRegisteredAgentAffordances(agent, toolkitCtx);
}

/**
 * Narrows a session {@link MemoriesClient} or {@link MemoriesClientAsync} to the wide shape expected by {@link memorySearchToolkit}.
 * Single boundary for assignability (clients are invariant in ontology generics).
 */
export function toMemorySearchEnv<TNode extends ZodLabelMap, TEdge extends ZodLabelMap>(args: {
  client: MemoriesClient<TNode, TEdge> | MemoriesClientAsync<TNode, TEdge>;
  namespace: string;
  additionalNamespaces?: readonly string[];
  memorySearchExtensions?: Record<string, unknown>;
  embeddingModel: EmbeddingModel;
  /** Per session; defaults to a new empty map. */
  embeddingCache?: Map<string, number[]>;
  /** When set, initializes {@link MemorySearchEnv.memorySearchBudget} with {@code used: 0}. */
  memorySearchBudgetMax?: number;
  memoriesSnapshotRootHex?: string;
}): MemorySearchEnv {
  const memorySearchBudget =
    args.memorySearchBudgetMax !== undefined
      ? { max: args.memorySearchBudgetMax, used: 0 }
      : undefined;
  return {
    memoriesClient: args.client as unknown as
      | HybridMemorySearchWideClient
      | HybridMemorySearchWideClientAsync,
    namespace: args.namespace,
    embeddingModel: args.embeddingModel,
    embeddingCache: args.embeddingCache ?? new Map(),
    ...(memorySearchBudget !== undefined ? { memorySearchBudget } : {}),
    ...(args.additionalNamespaces?.length
      ? { additionalNamespaces: args.additionalNamespaces }
      : {}),
    ...(args.memorySearchExtensions !== undefined &&
    Object.keys(args.memorySearchExtensions).length > 0
      ? { memorySearchExtensions: { ...args.memorySearchExtensions } }
      : {}),
    ...(args.memoriesSnapshotRootHex !== undefined
      ? { memoriesSnapshotRootHex: args.memoriesSnapshotRootHex }
      : {}),
  };
}

export function buildMemorySearchToolkitContext<
  TNode extends ZodLabelMap,
  TEdge extends ZodLabelMap,
>(args: {
  client: MemoriesClient<TNode, TEdge> | MemoriesClientAsync<TNode, TEdge>;
  namespace: string;
  additionalNamespaces?: readonly string[];
  memorySearchExtensions?: Record<string, unknown>;
  embeddingModel: EmbeddingModel;
  agentId?: string;
  agentName?: string;
  memorySearchBudgetMax?: number;
  memoriesSnapshotRootHex?: string;
  abortSignal?: AbortSignal;
}): ToolkitContext<MemorySearchEnv> {
  return {
    env: toMemorySearchEnv(args),
    namespace: args.namespace,
    agentId: args.agentId,
    agentName: args.agentName,
    ...(args.abortSignal !== undefined ? { abortSignal: args.abortSignal } : {}),
  };
}

export function buildMemorySearchToolRuntimeContext<
  TNode extends ZodLabelMap,
  TEdge extends ZodLabelMap,
>(args: {
  client: MemoriesClient<TNode, TEdge> | MemoriesClientAsync<TNode, TEdge>;
  namespace: string;
  additionalNamespaces?: readonly string[];
  memorySearchExtensions?: Record<string, unknown>;
  embeddingModel: EmbeddingModel;
  agentId?: string;
  agentName?: string;
  memorySearchBudgetMax?: number;
  memoriesSnapshotRootHex?: string;
  abortSignal?: AbortSignal;
}): ToolRuntimeContext<MemorySearchEnv> {
  return {
    env: toMemorySearchEnv(args),
    namespace: args.namespace,
    agentId: args.agentId,
    agentName: args.agentName,
    ...(args.abortSignal !== undefined ? { abortSignal: args.abortSignal } : {}),
  };
}
