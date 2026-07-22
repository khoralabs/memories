import { policy, tool, toolkit } from "@khoralabs/agent-capabilities";
import type {
  EmbeddingModel,
  HybridMemorySearchClient,
  HybridMemorySearchInput,
  HybridMemorySearchWideClient,
  HybridMemorySearchWideClientAsync,
  MemorySearchHit,
} from "@khoralabs/memories-node/helpers";
import { runHybridMemorySearch } from "@khoralabs/memories-node/helpers";
import z from "zod";

/** Re-exported from `@khoralabs/memories-node/helpers` for backward compatibility. */
export type {
  HybridMemorySearchInput,
  HybridMemorySearchOptions,
  MemorySearchHit,
} from "@khoralabs/memories-node/helpers";
/** Re-exported from `@khoralabs/memories-node/helpers` for backward compatibility. */
export { embeddingCacheKey } from "@khoralabs/memories-node/helpers";

/** Runtime env for {@link memorySearchToolkit}: memory store, namespace, and optional embedding model (injected; not tool args). */
export type MemorySearchEnv = {
  /** Name avoids clashing with other composed toolkits that use {@code client} for a domain API. */
  memoriesClient: HybridMemorySearchWideClient | HybridMemorySearchWideClientAsync;
  namespace: string;
  /** Used to embed query text for the vector retrieval arm when that arm is active. */
  embeddingModel?: EmbeddingModel;
  /**
   * Optional per-session cache for query embedding vectors (same normalized key as {@link embeddingCacheKey}).
   * Instantiated in {@link buildMemorySearchToolkitContext}.
   */
  embeddingCache?: Map<string, number[]>;
  /**
   * When set (via {@link toMemorySearchEnv} / host), {@link memorySearchBudgetPolicy} gates each call and
   * {@link memorySearchTool} increments {@code used} after a completed search.
   */
  memorySearchBudget?: { max: number; used: number };
  /**
   * Extra subtree roots merged with {@link namespace} for retrieval (same semantics as
   * {@link SearchParams.additionalNamespaces} in `@khoralabs/memories-node`).
   */
  additionalNamespaces?: readonly string[];
  /**
   * Host-injected bag for co-located domain toolkits (same session {@link ToolkitContext} env).
   */
  memorySearchExtensions?: Record<string, unknown>;
  /**
   * Store-wide provenance head (`root_hex`) captured at session attach, or `""` when the chain is empty.
   * Drives runtime {@code memory_search} tool identity and optional as-of search when the backend supports it.
   */
  memoriesSnapshotRootHex?: string;
  /**
   * When set, {@link memorySearchTool} adds each hit and neighbor {@code memory_key} after every search.
   */
  discoveredMemoryKeys?: Set<string>;
};

/** Record slim search hit keys (and neighbor keys) into a session accumulator. */
export function recordDiscoveredMemoryKeys(
  hits: MemorySearchHit[],
  discoveredMemoryKeys: Set<string> | undefined,
): void {
  if (discoveredMemoryKeys === undefined) return;
  for (const hit of hits) {
    discoveredMemoryKeys.add(hit.memory_key);
    for (const neighbor of hit.neighbors ?? []) {
      discoveredMemoryKeys.add(neighbor.memory_key);
    }
  }
}

/** Tool key used with {@link memorySearchRuntimeToolAugments} / runtime identity. */
export const MEMORY_SEARCH_TOOL_NAME = "memory_search" as const;

/** Fold {@link MemorySearchEnv.memoriesSnapshotRootHex} into runtime tool refs / `runtimeHash` (see `@khoralabs/agent-capabilities`). */
export function memorySearchRuntimeToolAugments(
  memoriesSnapshotRootHex: string | undefined,
): Record<string, string> | undefined {
  if (memoriesSnapshotRootHex === undefined) return undefined;
  return { [MEMORY_SEARCH_TOOL_NAME]: memoriesSnapshotRootHex };
}

/** Spread into `computeFullCapabilityLink` (`@khoralabs/agent-capabilities`) together with session `ToolkitContext`. */
export function memorySearchIdentityLinkSupplement(
  env: Pick<MemorySearchEnv, "memoriesSnapshotRootHex">,
): {
  runtimeToolAugments?: Record<string, string>;
  invocationContext?: { memoriesProvenanceRootHex: string };
  invocationContextAllowlist?: string[];
} {
  if (env.memoriesSnapshotRootHex === undefined) return {};
  const hex = env.memoriesSnapshotRootHex;
  return {
    runtimeToolAugments: { [MEMORY_SEARCH_TOOL_NAME]: hex },
    invocationContext: { memoriesProvenanceRootHex: hex },
    invocationContextAllowlist: ["memoriesProvenanceRootHex"],
  };
}

/** Policy id for {@link memorySearchBudgetPolicy} (hash-stable). */
export const MEMORY_SEARCH_BUDGET_POLICY_ID = "memory_search_budget";

/** Gates {@code memory_search} while {@code used < max}; no-op when {@link MemorySearchEnv.memorySearchBudget} is absent. */
export const memorySearchBudgetPolicy = policy<MemorySearchEnv>(
  MEMORY_SEARCH_BUDGET_POLICY_ID,
  async (env) => {
    const b = env.memorySearchBudget;
    if (b === undefined) return true;
    return b.used < b.max;
  },
);

const zSearchContent = z
  .object({
    text: z.string().describe("Query string for FTS + embedding (no raw vector)."),
  })
  .strict();

const zNeighborNodesFilter = z
  .object({
    all: z.array(z.string()).optional().describe("Neighbor node labels: AND."),
    some: z.array(z.string()).optional().describe("Neighbor node labels: OR."),
  })
  .describe("Filter neighbor memory node labels.");

const zNeighborConstraint = z.object({
  label: z.string().describe("Edge label kind for neighbor expansion."),
  direction: z.enum(["in", "out"]).optional(),
  nodes: zNeighborNodesFilter.optional(),
});

const zMemorySearchOptions = z
  .object({
    topK: z.number().int().positive().optional().describe("Max hits after fusion."),
    minScore: z.number().optional().describe("Min fused score."),
    labels: z
      .object({
        all: z.array(z.string()).optional().describe("Root hit: node labels AND."),
        some: z.array(z.string()).optional().describe("Root hit: node labels OR."),
      })
      .optional(),
    neighbors: z
      .union([
        z.literal("all").describe("All depth-1 neighbors."),
        z.literal("off").describe("No neighbors."),
        z
          .object({
            all: z.array(zNeighborConstraint).optional(),
            some: z.array(zNeighborConstraint).optional(),
          })
          .describe("Filtered neighbor edges."),
      ])
      .optional(),
    maxNeighbors: z.number().int().nonnegative().optional().describe("Cap neighbors per root hit."),
    arms: z
      .object({
        lexical: z.number().optional().describe("RRF weight: BM25."),
        vector: z.number().optional().describe("RRF weight: vector."),
      })
      .optional()
      .describe("Lexical vs vector fusion weights; default 1:1. Set one to 0 to disable that arm."),
  })
  .strict();

export const zMemorySearchToolInput = z
  .object({
    content: zSearchContent.describe("Query text; host embeds and hybrid-searches."),
    options: zMemorySearchOptions.optional().describe("Optional filters and RRF tuning."),
  })
  .strict();

export type MemorySearchToolInput = z.infer<typeof zMemorySearchToolInput>;

const memorySearchTool = tool<
  "memory_search",
  MemorySearchToolInput,
  MemorySearchHit[],
  MemorySearchEnv
>({
  name: "memory_search",
  description:
    "Hybrid search (FTS + embedding) fused with RRF. Primary namespace, optional additional namespace roots, and embed model are session-scoped. Tune options.arms for keyword vs semantic emphasis. When the host sets a search budget, further calls are denied until the env is reset for a new turn.",
  inputSchema: zMemorySearchToolInput,
  policies: [memorySearchBudgetPolicy],
  handler: async (ctx, input) => {
    const env = ctx.env;
    const parsed = zMemorySearchToolInput.parse(input);
    const slim = await runHybridMemorySearch(
      env.memoriesClient as HybridMemorySearchClient,
      {
        namespace: env.namespace,
        additionalNamespaces: env.additionalNamespaces,
        embeddingModel: env.embeddingModel,
        embeddingCache: env.embeddingCache,
        memoriesSnapshotRootHex: env.memoriesSnapshotRootHex,
      },
      parsed as HybridMemorySearchInput,
    );

    recordDiscoveredMemoryKeys(slim, env.discoveredMemoryKeys);

    const budget = env.memorySearchBudget;
    if (budget !== undefined) {
      budget.used += 1;
    }

    return slim;
  },
});

/**
 * Agent-capabilities composable: hybrid DB search before merge.
 * Evaluate with {@link evaluateComposable} from `@khoralabs/agent-capabilities` and {@link MemorySearchEnv}.
 */
export const memorySearchToolkit = toolkit([memorySearchTool], {
  name: "memory-search-toolkit",
});
