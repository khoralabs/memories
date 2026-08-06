import type { NamespacePath } from "../../persistence/core";
import {
  isPrefixOf,
  namespaceFromSegments,
  namespacePath,
  namespaceSegments,
} from "../../persistence/core";
import type { SearchContent, SearchHit, SearchParams } from "../api/search.js";
import { fuseRrf, type RrfArm } from "../rrf/index.js";
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
  /**
   * Ranking score: volume formula for nodes-only / lexical-only, or {@link fuseRrf} score
   * when nodes + lexical arms are fused.
   */
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
   * Larger → better coverage across namespaces; costlier. Ignored when `arms.nodes` is 0.
   */
  nodeTopK?: number;
  /**
   * Arm weights drive which path runs:
   * - `nodes` — unscoped memory/node search (default `1` when omitted; `0` skips memory search)
   * - `lexical` — memory content FTS when `nodes > 0`; also ranks catalog alias/description/path.
   *   When both `nodes` and `lexical` are &gt; 0, namespace lists are fused with {@link fuseRrf}.
   * - `vector` — memory content vector arm when `nodes > 0` (needs embeddingModel)
   *
   * Lexical-only: `{ nodes: 0, lexical: 1 }`. Nodes without metadata: `{ nodes: 1, lexical: 0, vector: 1 }`.
   */
  arms?: { nodes?: number; lexical?: number; vector?: number };
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

function resolveNamespaceSearchArms(
  inputArms: NamespaceSearchInput["arms"],
  embeddingModel: NamespaceSearchContext["embeddingModel"],
): {
  nodesWeight: number;
  lexicalWeight: number;
  vectorWeight: number;
  contentArms?: { lexical?: number; vector?: number };
} {
  // Missing `nodes` defaults to 1 so legacy `{ lexical, vector }` callers keep memory search.
  const nodesWeight = inputArms?.nodes !== undefined ? Math.max(0, inputArms.nodes) : 1;

  if (inputArms === undefined) {
    if (embeddingModel !== undefined) {
      // Match prior helper: omit content arms → search uses default RRF (lexical+vector weights 1).
      return { nodesWeight: 1, lexicalWeight: 1, vectorWeight: 1 };
    }
    return {
      nodesWeight: 1,
      lexicalWeight: 1,
      vectorWeight: 0,
      contentArms: { lexical: 1, vector: 0 },
    };
  }

  const lexicalWeight = inputArms.lexical !== undefined ? Math.max(0, inputArms.lexical) : 1;
  const vectorWeight = inputArms.vector !== undefined ? Math.max(0, inputArms.vector) : 1;
  return {
    nodesWeight,
    lexicalWeight,
    vectorWeight,
    contentArms: { lexical: lexicalWeight, vector: vectorWeight },
  };
}

function rankNamespacesFromMetadataOnly(
  query: string,
  metadata: readonly NamespaceMetadataForRank[],
  options: { limit: number; under: string | null },
): NamespaceSearchHit[] {
  const under =
    options.under !== null && options.under.trim().length > 0
      ? namespacePath(options.under.trim())
      : undefined;

  const ranked: NamespaceSearchHit[] = [];
  for (const meta of metadata) {
    if (under !== undefined && !isPrefixOf(under, meta.namespace)) continue;
    const score = namespaceMetadataLexicalScore(query, meta);
    if (score <= 0) continue;
    ranked.push({
      namespace: meta.namespace,
      lineage: namespaceLineage(meta.namespace),
      score,
      hitCount: 0,
      scoreSum: score,
      scoreMax: score,
      topHits: [],
    });
  }

  ranked.sort((a, b) => b.score - a.score || a.namespace.localeCompare(b.namespace));
  return ranked.slice(0, options.limit);
}

/**
 * Fuse a nodes-evidence ranking with a metadata-lexical ranking via {@link fuseRrf}.
 * Final `score` is the RRF score; hit evidence is taken from the nodes list when present.
 */
export function fuseNamespaceNodeAndLexicalArms(
  nodesRanked: readonly NamespaceSearchHit[],
  lexicalRanked: readonly NamespaceSearchHit[],
  options: {
    nodesWeight: number;
    lexicalWeight: number;
    limit: number;
  },
): NamespaceSearchHit[] {
  const arms: RrfArm<string>[] = [];
  if (nodesRanked.length > 0 && options.nodesWeight > 0) {
    arms.push({
      armId: "nodes",
      ranked: nodesRanked.map((n) => n.namespace),
      weight: options.nodesWeight,
    });
  }
  if (lexicalRanked.length > 0 && options.lexicalWeight > 0) {
    arms.push({
      armId: "lexical",
      ranked: lexicalRanked.map((n) => n.namespace),
      weight: options.lexicalWeight,
    });
  }
  if (arms.length === 0) return [];

  const nodesByNs = new Map(nodesRanked.map((n) => [n.namespace, n]));
  const lexicalByNs = new Map(lexicalRanked.map((n) => [n.namespace, n]));
  const fused = fuseRrf(arms, { maxPerArm: MAX_LIMIT });

  return fused.slice(0, options.limit).map((row) => {
    const fromNodes = nodesByNs.get(row.id);
    const fromLexical = lexicalByNs.get(row.id);
    return {
      namespace: row.id,
      lineage: fromNodes?.lineage ?? fromLexical?.lineage ?? namespaceLineage(row.id),
      score: row.score,
      hitCount: fromNodes?.hitCount ?? 0,
      scoreSum: fromNodes?.scoreSum ?? fromLexical?.scoreSum ?? 0,
      scoreMax: fromNodes?.scoreMax ?? fromLexical?.scoreMax ?? 0,
      topHits: fromNodes?.topHits ?? [],
    };
  });
}

/**
 * Arms-driven namespace search: unscoped node search and/or catalog metadata lexical ranking.
 *
 * Peer to {@link runHybridMemorySearch}: when `arms.nodes > 0`, aggregates memory-content hits by
 * exact `memory.namespace`. When both `arms.nodes` and `arms.lexical` are &gt; 0, the nodes ranking
 * and metadata ranking are fused with {@link fuseRrf} (metadata-only namespaces can surface).
 * When `arms.nodes === 0` and `arms.lexical > 0`, ranks the catalog with
 * {@link namespaceMetadataLexicalScore} only.
 *
 * Unscoped memory search requires persistence capability `unscopedSearch`.
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
  const { nodesWeight, lexicalWeight, vectorWeight, contentArms } = resolveNamespaceSearchArms(
    input.arms,
    embeddingModel,
  );

  if (nodesWeight <= 0 && lexicalWeight <= 0) {
    throw new Error("searchNamespaces: at least one of arms.nodes or arms.lexical must be > 0");
  }

  const loadMetadata = async (): Promise<NamespaceMetadataForRank[]> => {
    const listed = await Promise.resolve(client.persistence.listNamespacesWithMetadata());
    return listed.map((m) => ({
      namespace: m.namespace,
      alias: m.alias,
      description: m.description,
    }));
  };

  // Lexical-only: catalog metadata ranking, no unscoped memory search.
  if (nodesWeight <= 0) {
    const metadata = await loadMetadata();
    const namespaces = rankNamespacesFromMetadataOnly(query, metadata, { limit, under });
    return { query, under, namespaces };
  }

  if (lexicalWeight <= 0 && vectorWeight <= 0) {
    throw new Error(
      "searchNamespaces: when arms.nodes > 0, at least one of arms.lexical or arms.vector must be > 0",
    );
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
    ...(asOfTs !== undefined ? { asOf: { lte: asOfTs } } : {}),
    options: {
      topK: nodeTopK,
      neighbors: neighborOptionForSearch("off"),
      ...(contentArms !== undefined ? { arms: contentArms } : {}),
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

  // Nodes arm: aggregate memory hits without multiplicative metadata boost.
  const nodesRanked = rankNamespacesFromHits(rankable, {
    limit: MAX_LIMIT,
    ...(under !== null ? { under } : {}),
    metadataBoost: 0,
  });

  if (lexicalWeight <= 0) {
    return { query, under, namespaces: nodesRanked.slice(0, limit) };
  }

  // Both arms: RRF-fuse nodes ranking with catalog metadata ranking.
  const metadata = await loadMetadata();
  const lexicalRanked = rankNamespacesFromMetadataOnly(query, metadata, {
    limit: MAX_LIMIT,
    under,
  });
  const namespaces = fuseNamespaceNodeAndLexicalArms(nodesRanked, lexicalRanked, {
    nodesWeight,
    lexicalWeight,
    limit,
  });

  return { query, under, namespaces };
}
