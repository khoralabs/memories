import type { LabelSchemaMap } from "../../ontology/ontology.ts";
import type { NamespacePath, OntologyLabelInstance } from "../../persistence/core";
import type {
  MemoriesPersistence,
  MemoriesPersistenceAsync,
} from "../../persistence/core/persistence";
import type { MemoriesClient } from "../api/client.js";
import type { MemoriesClientAsync } from "../api/client-async.js";
import type {
  NeighborSearchOption,
  SearchContent,
  SearchHit,
  SearchParams,
} from "../api/search.js";
import type { EmbeddingModel } from "./embedding-model.js";
import { embedTextChunks } from "./embedding-model.js";

/** Wide client shape for hybrid search (matches agent-session widening). */
export type HybridMemorySearchWideClient = MemoriesClient<LabelSchemaMap, LabelSchemaMap>;

export type HybridMemorySearchWideClientAsync = MemoriesClientAsync<LabelSchemaMap, LabelSchemaMap>;

export type HybridMemorySearchClient =
  | HybridMemorySearchWideClient
  | HybridMemorySearchWideClientAsync;

/**
 * Per-session embedding cache key (see {@link HybridMemorySearchContext.embeddingCache}).
 * When `additionalNamespaces` is set, it is folded in so vectors are not reused across different search scopes.
 */
export function embeddingCacheKey(
  namespace: string,
  queryText: string,
  additionalNamespaces?: readonly string[],
  searchScopeMode: "pathSubtree" | "scopeDag" | "exactScope" = "pathSubtree",
): string {
  const q = queryText.trim();
  if (additionalNamespaces?.length) {
    const extra = [...additionalNamespaces].sort((a, b) => a.localeCompare(b)).join("\n");
    return `${namespace}\n${extra}\n${searchScopeMode}\n${q}`;
  }
  return `${namespace}\n${searchScopeMode}\n${q}`;
}

export type HybridNeighborNodesFilter = {
  all?: string[];
  some?: string[];
};

export type HybridNeighborConstraint = {
  label: string;
  direction?: "in" | "out";
  nodes?: HybridNeighborNodesFilter;
};

export type HybridMemorySearchNeighborsOption =
  | "all"
  | "off"
  | {
      all?: HybridNeighborConstraint[];
      some?: HybridNeighborConstraint[];
    };

/** Neutral search options (same semantics as `memory_search` tool `options`). */
export type HybridMemorySearchOptions = {
  topK?: number;
  minScore?: number;
  labels?: { all?: string[]; some?: string[] };
  neighbors?: HybridMemorySearchNeighborsOption;
  maxNeighbors?: number;
  arms?: { lexical?: number; vector?: number };
  maxVectorDistance?: number;
};

/** Neutral hybrid search input (query text + optional filters / RRF tuning). */
export type HybridMemorySearchInput = {
  content: { text: string };
  options?: HybridMemorySearchOptions;
  /**
   * How to interpret `namespace` / `additionalNamespaces` for retrieval (default `pathSubtree`).
   * Use `scopeDag` when searching from DAG scope roots (e.g. `khora/<profileId>` with `attachScopes`).
   */
  searchScopeMode?: "pathSubtree" | "scopeDag" | "exactScope";
};

/**
 * Slim search result (keys, scores, labels) — avoids serializing full {@link SearchHit} rows.
 * Neighbor rows are capped when present.
 */
export type MemorySearchHit = {
  namespace: string;
  memory_key: string;
  kind: "node" | "edge";
  score: number;
  labels: OntologyLabelInstance[];
  source_key: string;
  edge?: { from_key: string; to_key: string; edge_label_kinds: string[] };
  neighbors?: Array<{ memory_key: string; labels: OntologyLabelInstance[] }>;
};

const MAX_NEIGHBORS_PER_HIT = 8;

function mapSearchHit(hit: SearchHit): MemorySearchHit {
  const row: MemorySearchHit = {
    namespace: hit.memory.namespace,
    memory_key: hit.memory.key,
    kind: hit.graph.kind === "edge" ? "edge" : "node",
    score: hit.score,
    labels: [...hit.labels],
    source_key: hit.source_key,
  };
  if (hit.graph.kind === "edge") {
    row.edge = {
      from_key: hit.graph.edge.fromKey,
      to_key: hit.graph.edge.toKey,
      edge_label_kinds: hit.graph.edge.labels.map((l) => l.kind),
    };
  }
  if (hit.neighbors?.length) {
    row.neighbors = hit.neighbors.slice(0, MAX_NEIGHBORS_PER_HIT).map((n) => ({
      memory_key: n.key,
      labels: [...n.labels],
    }));
  }
  return row;
}

/** Map core {@link SearchHit} rows to slim {@link MemorySearchHit} rows. */
export function mapSearchHits(hits: SearchHit[]): MemorySearchHit[] {
  return hits.map(mapSearchHit);
}

/** Maps neutral neighbor option to {@link SearchParams} `options.neighbors`. */
export function neighborOptionForSearch(
  neighbors: HybridMemorySearchNeighborsOption | undefined,
): NeighborSearchOption | undefined {
  if (neighbors === undefined) return undefined;
  if (neighbors === "all") return true;
  if (neighbors === "off") return false;
  return neighbors;
}

export type HybridMemorySearchContext = {
  namespace: string;
  additionalNamespaces?: readonly string[];
  /** Required when `options.arms.vector` is &gt; 0 (default vector arm weight is 1). */
  embeddingModel?: EmbeddingModel;
  embeddingCache?: Map<string, number[]>;
  /**
   * Store-wide provenance head (`root_hex`), or `""` when empty.
   * When set and non-empty, enables as-of search when persistence supports it.
   */
  memoriesSnapshotRootHex?: string;
  /** Optional timing callback for toolkit / host structured logs (not an OTel span). */
  onTiming?: (timing: { embedMs: number; searchMs: number; embedCacheHit: boolean }) => void;
};

export async function resolveAsOfTimestampMs(args: {
  persistence: MemoriesPersistence | MemoriesPersistenceAsync;
  memoriesSnapshotRootHex: string | undefined;
}): Promise<number | undefined> {
  const snap = args.memoriesSnapshotRootHex;
  if (snap === undefined || snap === "") return undefined;
  const fn = args.persistence.getProvenanceTimestampMsForRootHex;
  if (fn === undefined) return undefined;
  const out = fn.call(args.persistence, snap);
  return (await Promise.resolve(out)) as number | undefined;
}

/**
 * Hybrid lexical + vector search: embed query when the vector arm is active, then {@link MemoriesClient.search}.
 */
export async function runHybridMemorySearch(
  client: HybridMemorySearchClient,
  context: HybridMemorySearchContext,
  input: HybridMemorySearchInput,
): Promise<MemorySearchHit[]> {
  const opts = input.options;
  const lexicalWeight = opts?.arms?.lexical ?? 1;
  const vectorWeight = opts?.arms?.vector ?? 1;
  if (lexicalWeight <= 0 && vectorWeight <= 0) {
    throw new Error(
      "runHybridMemorySearch: at least one of options.arms.lexical or options.arms.vector must be > 0",
    );
  }

  const queryText = input.content.text;

  const searchScopeMode = input.searchScopeMode ?? "pathSubtree";

  let content: SearchContent;
  let embedMs = 0;
  let embedCacheHit = false;
  const embedStart = performance.now();
  if (vectorWeight > 0) {
    const model = context.embeddingModel;
    if (model === undefined) {
      throw new Error(
        "runHybridMemorySearch: embeddingModel is required when options.arms.vector is > 0",
      );
    }
    const cacheKey = embeddingCacheKey(
      context.namespace,
      queryText,
      context.additionalNamespaces,
      searchScopeMode,
    );
    const cache = context.embeddingCache;
    let vector: number[] | undefined = cache?.get(cacheKey);

    if (!vector) {
      const embeddings = await embedTextChunks(model, [queryText]);
      vector = embeddings[0];
      if (!vector) {
        throw new Error(
          "runHybridMemorySearch: embedding pipeline returned no vector for query text",
        );
      }
      cache?.set(cacheKey, vector);
    } else {
      embedCacheHit = true;
    }
    embedMs = performance.now() - embedStart;

    content = lexicalWeight > 0 ? { text: queryText, vector } : { vector };
  } else {
    content = { text: queryText };
  }

  const asOfTs = await resolveAsOfTimestampMs({
    persistence: client.persistence,
    memoriesSnapshotRootHex: context.memoriesSnapshotRootHex,
  });

  const searchParams: SearchParams<string, string> = {
    namespace: context.namespace as NamespacePath,
    ...(context.additionalNamespaces?.length
      ? { additionalNamespaces: [...context.additionalNamespaces] as NamespacePath[] }
      : {}),
    content,
    searchScopeMode,
    ...(asOfTs !== undefined ? { asOf: { lte: asOfTs } } : {}),
    options: opts
      ? {
          ...opts,
          neighbors: neighborOptionForSearch(opts.neighbors),
        }
      : undefined,
  };

  const searchStart = performance.now();
  const raw = await Promise.resolve(client.search(searchParams));
  const searchMs = performance.now() - searchStart;
  const rawHits = Array.isArray(raw) ? raw : raw.hits;

  const hits = mapSearchHits(rawHits as SearchHit[]);
  if (context.onTiming !== undefined) {
    context.onTiming({ embedMs, searchMs, embedCacheHit });
  }
  return hits;
}
