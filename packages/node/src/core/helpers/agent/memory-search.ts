import type { SearchAsOf } from "../../index.ts";
import {
  type EmbeddingModel,
  type HybridMemorySearchNeighborsOption,
  type MemorySearchHit,
  type NamespaceSearchResult,
  runHybridMemorySearch,
  searchNamespaces,
} from "../index.ts";
import type { HybridMemorySearchClient } from "../memory-search-pipeline.js";

export type AgentMemorySearchClient = HybridMemorySearchClient & {
  persistence: HybridMemorySearchClient["persistence"] & {
    getProvenanceHeadRootHex?(): Promise<string | null | undefined> | string | null | undefined;
    getProvenanceTimestampMsForRootHex?(
      rootHex: string,
    ): Promise<number | null | undefined> | number | null | undefined;
    listNamespacesWithMetadata?(): Promise<
      Array<{ namespace: string; alias?: string | null; description?: string | null }>
    >;
    getNamespaceMetadata?(namespace: string): Promise<{ suppressed?: boolean } | null | undefined>;
  };
};

export const MEMORY_SEARCH_SCOPE_SUBTREE = "pathSubtree" as const;
export const MEMORY_SEARCH_SCOPE_EXACT = "exactScope" as const;

export type MemorySearchScopeMode =
  | typeof MEMORY_SEARCH_SCOPE_SUBTREE
  | typeof MEMORY_SEARCH_SCOPE_EXACT;

export const EMBEDDING_MODEL_REQUIRED_MESSAGE =
  "AI_GATEWAY_API_KEY is required for hybrid memory search (set it on this service's env)";

export async function resolveMemoriesHeadRootHex(
  client: AgentMemorySearchClient,
): Promise<string | undefined> {
  const fn = client.persistence.getProvenanceHeadRootHex;
  if (fn === undefined) return undefined;
  const out = await fn.call(client.persistence);
  const hex = (out ?? "").trim();
  return hex.length > 0 ? hex : undefined;
}

export async function resolveMemoriesSearchAsOf(
  client: AgentMemorySearchClient,
): Promise<SearchAsOf | undefined> {
  const rootHex = await resolveMemoriesHeadRootHex(client);
  if (rootHex === undefined) return undefined;
  const tsFn = client.persistence.getProvenanceTimestampMsForRootHex;
  if (tsFn === undefined) return undefined;
  const out = tsFn.call(client.persistence, rootHex);
  const ts = await Promise.resolve(out);
  return typeof ts === "number" && Number.isFinite(ts) ? { lte: ts } : undefined;
}

export type StandardHybridMemorySearchInput = {
  namespace: string;
  query: string;
  embeddingModel?: EmbeddingModel;
  embeddingCache?: Map<string, number[]>;
  searchScopeMode?: MemorySearchScopeMode;
  topK?: number;
  neighbors?: HybridMemorySearchNeighborsOption;
  maxNeighbors?: number;
  maxVectorDistance?: number;
  arms?: { lexical: number; vector: number };
  requireEmbedding?: boolean;
};

export async function runStandardHybridMemorySearch(
  client: AgentMemorySearchClient,
  input: StandardHybridMemorySearchInput,
): Promise<MemorySearchHit[]> {
  const embeddingModel = input.embeddingModel;
  if (input.requireEmbedding === true && embeddingModel === undefined) {
    throw new Error(EMBEDDING_MODEL_REQUIRED_MESSAGE);
  }

  const memoriesSnapshotRootHex = await resolveMemoriesHeadRootHex(client);
  return runHybridMemorySearch(
    client,
    {
      namespace: input.namespace,
      embeddingModel,
      embeddingCache: input.embeddingCache,
      ...(memoriesSnapshotRootHex !== undefined ? { memoriesSnapshotRootHex } : {}),
    },
    {
      content: { text: input.query },
      searchScopeMode: input.searchScopeMode ?? MEMORY_SEARCH_SCOPE_SUBTREE,
      options: {
        topK: input.topK ?? 12,
        neighbors: input.neighbors ?? "off",
        ...(input.maxNeighbors !== undefined ? { maxNeighbors: input.maxNeighbors } : {}),
        ...(input.maxVectorDistance !== undefined
          ? { maxVectorDistance: input.maxVectorDistance }
          : {}),
        arms: input.arms ?? (embeddingModel !== undefined ? undefined : { lexical: 1, vector: 0 }),
      },
    },
  );
}

export type NamespaceSearchArms = {
  nodes?: number;
  lexical?: number;
  vector?: number;
};

export type EnrichedNamespaceSearchHit = NamespaceSearchResult["namespaces"][number] & {
  alias: string | null;
  description: string;
};

export type EnrichedNamespaceSearchResult = Omit<NamespaceSearchResult, "namespaces"> & {
  namespaces: EnrichedNamespaceSearchHit[];
};

export type StandardNamespaceSearchInput = {
  query: string;
  under?: string;
  embeddingModel?: EmbeddingModel;
  embeddingCache?: Map<string, number[]>;
  limit?: number;
  contentRanking?: boolean;
  arms?: NamespaceSearchArms;
  requireEmbedding?: boolean;
};

async function enrichNamespaceSearchHits(
  client: AgentMemorySearchClient,
  result: NamespaceSearchResult,
): Promise<EnrichedNamespaceSearchResult> {
  const withMeta = client.persistence.listNamespacesWithMetadata;
  const metaByNs = new Map<string, { alias: string | null; description: string }>();
  if (withMeta !== undefined) {
    const rows = await withMeta.call(client.persistence);
    for (const row of rows) {
      metaByNs.set(row.namespace, {
        alias: row.alias ?? null,
        description: row.description ?? "",
      });
    }
  }

  return {
    ...result,
    namespaces: result.namespaces.map((hit) => {
      const meta = metaByNs.get(hit.namespace);
      return {
        ...hit,
        alias: meta?.alias ?? null,
        description: meta?.description ?? "",
      };
    }),
  };
}

export async function runStandardNamespaceSearch(
  client: AgentMemorySearchClient,
  input: StandardNamespaceSearchInput,
): Promise<EnrichedNamespaceSearchResult> {
  const embeddingModel = input.embeddingModel;
  if (input.requireEmbedding === true && embeddingModel === undefined) {
    throw new Error(EMBEDDING_MODEL_REQUIRED_MESSAGE);
  }

  const under = input.under?.trim();
  const namespace = under !== undefined && under.length > 0 ? under : "";
  const memoriesSnapshotRootHex = await resolveMemoriesHeadRootHex(client);

  const arms: NamespaceSearchArms | undefined =
    input.arms ?? (input.contentRanking === false ? { nodes: 0, lexical: 1 } : undefined);

  const result = await searchNamespaces(
    client,
    {
      namespace,
      embeddingModel,
      embeddingCache: input.embeddingCache,
      ...(memoriesSnapshotRootHex !== undefined ? { memoriesSnapshotRootHex } : {}),
    },
    {
      content: { text: input.query },
      ...(under !== undefined && under.length > 0 ? { under } : {}),
      ...(input.limit !== undefined ? { limit: input.limit } : {}),
      ...(arms !== undefined ? { arms } : {}),
    },
  );

  return enrichNamespaceSearchHits(client, result);
}
