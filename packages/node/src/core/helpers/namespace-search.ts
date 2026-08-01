import type { NamespacePath } from "../../persistence/core";
import {
  isPrefixOf,
  namespaceFromSegments,
  namespacePath,
  namespaceSegments,
} from "../../persistence/core";
import type { SearchContent, SearchHit, SearchParams } from "../api/search.js";
import { embedTextChunks } from "./embedding-model.js";
import type { HybridMemorySearchClient } from "./memory-search-pipeline.js";
import {
  type HybridMemorySearchContext,
  mapSearchHits,
  neighborOptionForSearch,
  resolveAsOfTimestampMs,
} from "./memory-search-pipeline.js";

export type NamespaceSearchTopHit = {
  memory_key: string;
  score: number;
  kind: "node" | "edge";
};

export type NamespaceSearchHit = {
  /** Exact namespace path */
  namespace: string;
  /** Ancestors + self, root → leaf */
  lineage: string[];
  /** namespaceScore (scoreSum * (1 + log1p(hitCount))) */
  score: number;
  hitCount: number;
  scoreSum: number;
  scoreMax: number;
  /** Up to N highest-scoring node hits in this namespace */
  topHits: NamespaceSearchTopHit[];
};

export type NamespaceSearchResult = {
  query: string;
  under: string | null;
  namespaces: NamespaceSearchHit[];
};

export type RankableMemoryHit = {
  namespace: string;
  memory_key: string;
  score: number;
  kind?: "node" | "edge";
};

/** Namespace display metadata used for lexical ranking boosts. */
export type NamespaceMetadataForRank = {
  namespace: string;
  alias: string | null;
  description: string;
};

export type RankNamespacesOptions = {
  /** Max namespaces returned (default 10, max 32) */
  limit?: number;
  /** Keep only namespaces under this path (inclusive) */
  under?: string;
  /** Max evidence rows per namespace (default 3) */
  topHitsPerNamespace?: number;
  /**
   * Lexical query text for metadata matching. Ignored when empty or when
   * {@link metadata} / {@link metadataBoost} are absent.
   */
  query?: string;
  /** Catalog rows for alias/description boost (from `listNamespacesWithMetadata`). */
  metadata?: readonly NamespaceMetadataForRank[];
  /**
   * Strength of lexical metadata boost in `content * (1 + boost * metaScore)`.
   * Default `0.25` when `query` + `metadata` are provided; `0` disables.
   * Vector-only searches should omit metadata (no lexical query component).
   */
  metadataBoost?: number;
};

export type NamespaceSearchContext = {
  /**
   * Primary namespace for SearchParams (required even when unscoped).
   * When `under` is set, prefer `under` here for logs/policy.
   */
  namespace: string;
  embeddingModel?: HybridMemorySearchContext["embeddingModel"];
  embeddingCache?: Map<string, number[]>;
  memoriesSnapshotRootHex?: string;
  onTiming?: HybridMemorySearchContext["onTiming"];
};

export type NamespaceSearchInput = {
  content: { text: string };
  /** Optional path filter after aggregation */
  under?: string;
  /** Namespaces to return (default 10, max 32) */
  limit?: number;
  /**
   * Node-hit pool size before aggregation (default 50, max 100).
   * Larger → better coverage across namespaces; costlier.
   */
  nodeTopK?: number;
  /** Passed through to hybrid search arms (default: RRF when embeddingModel set) */
  arms?: { lexical?: number; vector?: number };
};

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 32;
const DEFAULT_TOP_HITS = 3;
const DEFAULT_NODE_TOP_K = 50;
const MAX_NODE_TOP_K = 100;
const DEFAULT_METADATA_BOOST = 0.25;

function clampInt(n: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function tokenizeLexical(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((t) => t.length > 0);
}

/**
 * Fraction of unique query tokens that appear in alias, description, or path.
 * Returns 0 when the query has no tokens.
 */
export function namespaceMetadataLexicalScore(
  query: string,
  meta: NamespaceMetadataForRank,
): number {
  const qTokens = [...new Set(tokenizeLexical(query))];
  if (qTokens.length === 0) return 0;
  const doc = [meta.alias ?? "", meta.description, meta.namespace.replaceAll("/", " ")].join(" ");
  const docSet = new Set(tokenizeLexical(doc));
  let hits = 0;
  for (const t of qTokens) {
    if (docSet.has(t)) hits += 1;
  }
  return hits / qTokens.length;
}

/** Cumulative path prefixes root → leaf. Validates via {@link namespacePath}. */
export function namespaceLineage(namespace: string): string[] {
  const segs = namespaceSegments(namespacePath(namespace));
  const out: string[] = [];
  for (let i = 1; i <= segs.length; i++) {
    out.push(namespaceFromSegments(segs.slice(0, i)));
  }
  return out;
}

/**
 * Group → filter → score → sort. Does not search.
 * Evidence is exact-namespace only (no parent roll-up of child hits).
 * Optional lexical metadata boost: `contentScore * (1 + metadataBoost * metaScore)`.
 */
export function rankNamespacesFromHits(
  hits: readonly RankableMemoryHit[],
  options?: RankNamespacesOptions,
): NamespaceSearchHit[] {
  const limit = clampInt(options?.limit ?? DEFAULT_LIMIT, 1, MAX_LIMIT, DEFAULT_LIMIT);
  const topHitsPerNamespace = clampInt(
    options?.topHitsPerNamespace ?? DEFAULT_TOP_HITS,
    1,
    MAX_LIMIT,
    DEFAULT_TOP_HITS,
  );
  const under =
    options?.under !== undefined && options.under.trim().length > 0
      ? namespacePath(options.under.trim())
      : undefined;

  const query = options?.query?.trim() ?? "";
  const metadata = options?.metadata;
  const metadataBoost =
    options?.metadataBoost !== undefined
      ? Math.max(0, options.metadataBoost)
      : query.length > 0 && metadata !== undefined && metadata.length > 0
        ? DEFAULT_METADATA_BOOST
        : 0;
  const metaByNs =
    metadataBoost > 0 && query.length > 0 && metadata !== undefined
      ? new Map(metadata.map((m) => [m.namespace, m]))
      : undefined;

  const byNs = new Map<string, RankableMemoryHit[]>();
  for (const hit of hits) {
    const ns = hit.namespace;
    const list = byNs.get(ns);
    if (list !== undefined) list.push(hit);
    else byNs.set(ns, [hit]);
  }

  const ranked: NamespaceSearchHit[] = [];
  for (const [ns, nsHits] of byNs) {
    if (under !== undefined && !isPrefixOf(under, ns)) continue;

    let scoreSum = 0;
    let scoreMax = Number.NEGATIVE_INFINITY;
    for (const h of nsHits) {
      scoreSum += h.score;
      if (h.score > scoreMax) scoreMax = h.score;
    }
    const hitCount = nsHits.length;
    let score = scoreSum * (1 + Math.log1p(hitCount));
    if (metaByNs !== undefined) {
      const meta = metaByNs.get(ns) ?? {
        namespace: ns,
        alias: null,
        description: "",
      };
      const metaScore = namespaceMetadataLexicalScore(query, meta);
      score = score * (1 + metadataBoost * metaScore);
    }

    const sortedHits = [...nsHits].sort(
      (a, b) => b.score - a.score || a.memory_key.localeCompare(b.memory_key),
    );
    const topHits: NamespaceSearchTopHit[] = sortedHits.slice(0, topHitsPerNamespace).map((h) => ({
      memory_key: h.memory_key,
      score: h.score,
      kind: h.kind === "edge" ? "edge" : "node",
    }));

    ranked.push({
      namespace: ns,
      lineage: namespaceLineage(ns),
      score,
      hitCount,
      scoreSum,
      scoreMax: Number.isFinite(scoreMax) ? scoreMax : 0,
      topHits,
    });
  }

  ranked.sort(
    (a, b) =>
      b.score - a.score ||
      b.scoreMax - a.scoreMax ||
      b.hitCount - a.hitCount ||
      a.namespace.localeCompare(b.namespace),
  );

  return ranked.slice(0, limit);
}

/** Local embed cache key; includes unscoped discriminator so it does not collide with scoped hybrid search. */
function namespaceSearchEmbeddingCacheKey(namespace: string, queryText: string): string {
  return `${namespace}\nsearchEntireDatabase\n${queryText.trim()}`;
}

/**
 * Hybrid unscoped node search, then {@link rankNamespacesFromHits}.
 *
 * Peer to {@link runHybridMemorySearch}: aggregates memory-content hits by exact
 * `memory.namespace` (no new persistence indexes). When the lexical arm is active,
 * ranks with an in-memory boost from namespace alias/description
 * (`listNamespacesWithMetadata`). Vector-only searches skip metadata (no lexical query).
 *
 * Requires persistence capability `unscopedSearch`.
 */
export async function searchNamespaces(
  client: HybridMemorySearchClient,
  context: NamespaceSearchContext,
  input: NamespaceSearchInput,
): Promise<NamespaceSearchResult> {
  const query = input.content.text.trim();
  const underRaw = input.under?.trim();
  const under = underRaw !== undefined && underRaw.length > 0 ? underRaw : null;

  if (query.length === 0) {
    return { query: "", under, namespaces: [] };
  }

  const limit = clampInt(input.limit ?? DEFAULT_LIMIT, 1, MAX_LIMIT, DEFAULT_LIMIT);
  const nodeTopK = clampInt(
    input.nodeTopK ?? DEFAULT_NODE_TOP_K,
    1,
    MAX_NODE_TOP_K,
    DEFAULT_NODE_TOP_K,
  );

  const embeddingModel = context.embeddingModel;
  const arms = input.arms ?? (embeddingModel !== undefined ? undefined : { lexical: 1, vector: 0 });
  const lexicalWeight = arms?.lexical ?? 1;
  const vectorWeight = arms?.vector ?? 1;

  if (lexicalWeight <= 0 && vectorWeight <= 0) {
    throw new Error("searchNamespaces: at least one of arms.lexical or arms.vector must be > 0");
  }

  const primaryNamespace = (under ?? context.namespace) as NamespacePath;

  let content: SearchContent;
  let embedMs = 0;
  let embedCacheHit = false;
  const embedStart = performance.now();

  if (vectorWeight > 0) {
    const model = embeddingModel;
    if (model === undefined) {
      throw new Error("searchNamespaces: embeddingModel is required when arms.vector is > 0");
    }
    const cacheKey = namespaceSearchEmbeddingCacheKey(primaryNamespace, query);
    const cache = context.embeddingCache;
    let vector: number[] | undefined = cache?.get(cacheKey);
    if (!vector) {
      const embeddings = await embedTextChunks(model, [query]);
      vector = embeddings[0];
      if (!vector) {
        throw new Error("searchNamespaces: embedding pipeline returned no vector for query text");
      }
      cache?.set(cacheKey, vector);
    } else {
      embedCacheHit = true;
    }
    embedMs = performance.now() - embedStart;
    content = lexicalWeight > 0 ? { text: query, vector } : { vector };
  } else {
    content = { text: query };
  }

  const asOfTs = await resolveAsOfTimestampMs({
    persistence: client.persistence,
    memoriesSnapshotRootHex: context.memoriesSnapshotRootHex,
  });

  const searchParams: SearchParams<string, string> = {
    namespace: primaryNamespace,
    searchEntireDatabase: true,
    content,
    ...(asOfTs !== undefined ? { asOfTimestampMs: asOfTs } : {}),
    options: {
      topK: nodeTopK,
      neighbors: neighborOptionForSearch("off"),
      ...(arms !== undefined ? { arms } : {}),
    },
  };

  const searchStart = performance.now();
  let raw: SearchHit[] | { hits: SearchHit[] };
  try {
    raw = await Promise.resolve(client.search(searchParams));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/unscoped/i.test(message)) {
      throw new Error("searchNamespaces requires unscopedSearch (searchEntireDatabase)", {
        cause: error,
      });
    }
    throw error;
  }
  const searchMs = performance.now() - searchStart;

  if (context.onTiming !== undefined) {
    context.onTiming({ embedMs, searchMs, embedCacheHit });
  }

  const rawHits = Array.isArray(raw) ? raw : raw.hits;
  const slim = mapSearchHits(rawHits as SearchHit[]).filter((h) => h.kind === "node");
  const rankable: RankableMemoryHit[] = slim.map((h) => ({
    namespace: h.namespace,
    memory_key: h.memory_key,
    score: h.score,
    kind: h.kind,
  }));

  // Lexical arm only: boost with in-memory alias/description match. Vector-only skips metadata.
  let metadata: NamespaceMetadataForRank[] | undefined;
  if (lexicalWeight > 0) {
    const listed = await Promise.resolve(client.persistence.listNamespacesWithMetadata());
    metadata = listed.map((m) => ({
      namespace: m.namespace,
      alias: m.alias,
      description: m.description,
    }));
  }

  const namespaces = rankNamespacesFromHits(rankable, {
    limit,
    query,
    ...(under !== null ? { under } : {}),
    ...(metadata !== undefined ? { metadata } : {}),
  });

  return { query, under, namespaces };
}
