import type {
  HydratedNeighbor,
  MemoryGraphAssociation,
  NeighborFilter,
  OntologyLabelInstance,
  SearchAsOf,
} from "../../persistence/core";
import {
  canonicalizeNamespacePrefixes,
  type NamespacePath,
  namespacePath,
  normalizeSearchAsOf,
} from "../../persistence/core";
import type {
  Edge,
  MemoriesBackendCapabilities,
  Memory,
  SearchNamespaceScope,
  SourceMapRow,
  VectorSearchMethod,
} from "../../persistence/core/persistence";
import {
  type MemoriesPersistence,
  resolveMemoriesBackendCapabilities,
  resolveVectorSearchMethod,
} from "../../persistence/core/persistence";
import { runWithOpTelemetrySync } from "../../telemetry/index.js";
import { fuseRrf, type RrfArm } from "../rrf/index.js";
import type { MutationCtx } from "./merge-memory";

export type { SearchAsOf };

/** When `true`, expand with no neighbor edge filters (any label, any direction). `false` omits neighbors. */
export type NeighborSearchOption<
  NODE_LABELS extends string = string,
  EDGE_LABELS extends string = string,
> = boolean | NeighborFilter<EDGE_LABELS, NODE_LABELS>;

export type SearchContent =
  | { text: string }
  | { vector: number[] }
  | { text: string; vector: number[] };

/** Max distinct namespaces beyond the primary `namespace` allowed in one search (after dedupe). */
export const MAX_ADDITIONAL_NAMESPACES = 32;

export interface SearchParams<
  NODE_LABELS extends string = string,
  EDGE_LABELS extends string = string,
> {
  /** Primary namespace path (subtree root for retrieval). */
  namespace: NamespacePath;
  /**
   * Extra namespaces merged with `namespace` for retrieval (deduped union). Ignored when
   * `searchEntireDatabase` is set.
   */
  /** Additional subtree roots merged with `namespace` (deduped). */
  additionalNamespaces?: NamespacePath[];
  /**
   * Search all namespaces in the store. Requires persistence `unscopedSearch`. Ignores
   * `additionalNamespaces`; keep `namespace` for logs / future policy.
   */
  searchEntireDatabase?: true;
  /**
   * How `namespace` + `additionalNamespaces` are interpreted when not searching the entire DB.
   * Default `pathSubtree`: prefix match on the primary namespace column of each memory row.
   */
  searchScopeMode?: "pathSubtree" | "scopeDag" | "exactScope";
  content: SearchContent;
  options?: {
    topK?: number;
    minScore?: number;
    labels?: { all?: NODE_LABELS[]; some?: NODE_LABELS[] };
    neighbors?: NeighborSearchOption<NODE_LABELS, EDGE_LABELS>;
    /**
     * When neighbors are included, cap how many adjacent memories **per root hit** (each hit row
     * independently; not a shared budget across the whole result set). Omit = no cap.
     */
    maxNeighbors?: number;
    arms?: {
      vector?: number;
      lexical?: number;
    };
    /**
     * When set, drop vector candidates whose **distance** exceeds this value before RRF.
     * Lower distance = closer match. Omit = no distance cutoff (previous behavior).
     */
    maxVectorDistance?: number;
    /**
     * Select `knn` or `ann`; omit = ANN if available else KNN.
     * Unsupported selection is a noop for the vector arm.
     */
    vectorSearchMethod?: VectorSearchMethod;
  };
  /**
   * Bounds on `memories._ts_created` (`gt` / `gte` / `lt` / `lte`).
   * Requires persistence {@link MemoriesBackendCapabilities.asOfTimestampMsSearch}.
   */
  asOf?: SearchAsOf;
  /**
   * @deprecated Prefer `asOf: { lte }`. Alias for `{ lte: asOfTimestampMs }`.
   * Requires persistence {@link MemoriesBackendCapabilities.asOfTimestampMsSearch}.
   */
  asOfTimestampMs?: number;
}

export type SearchNeighborHit<
  _NODE_LABELS extends string = string,
  _EDGE_LABELS extends string = string,
> = Memory & {
  labels: OntologyLabelInstance[];
  edge: Edge & { label: OntologyLabelInstance };
  /** Fused RRF score from scoped neighbor sub-search. */
  neighborScore?: number;
  /** Best-matching `source_map` within the neighbor memory. */
  matchedSourceMapId?: string;
};

export interface SearchHit<NODE_LABELS extends string = string, EDGE_LABELS extends string = string>
  extends SourceMapRow {
  score: number;
  memory: Memory;
  labels: OntologyLabelInstance[];
  graph: MemoryGraphAssociation;
  neighbors?: Array<SearchNeighborHit<NODE_LABELS, EDGE_LABELS>>;
}

/** Hybrid search result: hits plus the vector method that ran (if any). */
export type SearchOutput<
  NODE_LABELS extends string = string,
  EDGE_LABELS extends string = string,
> = {
  hits: SearchHit<NODE_LABELS, EDGE_LABELS>[];
  vectorSearchMethod?: VectorSearchMethod;
};

function matchesLabelFilter(
  labels: readonly OntologyLabelInstance[],
  filter: { all?: string[]; some?: string[] } | undefined,
): boolean {
  const kinds = labels.map((l) => l.kind);
  if (!filter) return true;
  if (filter.all && !filter.all.every((label) => kinds.includes(label))) {
    return false;
  }
  if (
    filter.some &&
    filter.some.length > 0 &&
    !filter.some.some((label) => kinds.includes(label))
  ) {
    return false;
  }
  return true;
}

function pathSubtreeSingle(namespace: NamespacePath): SearchNamespaceScope {
  return { kind: "pathSubtree", namespaces: [namespace] };
}

export function normalizeSearchScopeFromParams(
  params: Pick<
    SearchParams,
    "namespace" | "additionalNamespaces" | "searchEntireDatabase" | "searchScopeMode"
  >,
  caps: MemoriesBackendCapabilities,
): {
  scope: SearchNamespaceScope;
  additionalNamespaceCount: number;
  unscoped: boolean;
} {
  if (params.searchEntireDatabase === true) {
    if (!caps.unscopedSearch) {
      throw new Error("unscoped search not supported by this persistence");
    }
    return { scope: { kind: "unscoped" }, additionalNamespaceCount: 0, unscoped: true };
  }

  const ordered: NamespacePath[] = [];
  const seen = new Set<string>();
  for (const raw of [params.namespace, ...(params.additionalNamespaces ?? [])]) {
    const p = namespacePath(raw as string);
    const key = p as string;
    if (seen.has(key)) continue;
    seen.add(key);
    ordered.push(p);
  }
  if (ordered.length === 0) {
    throw new Error("search scope: at least one namespace required");
  }
  const additionalCount = ordered.length - 1;
  if (additionalCount > MAX_ADDITIONAL_NAMESPACES) {
    throw new Error(`additionalNamespaces exceeds max (${MAX_ADDITIONAL_NAMESPACES})`);
  }
  const canonical = canonicalizeNamespacePrefixes(ordered);
  const mode = params.searchScopeMode ?? "pathSubtree";
  if (mode === "pathSubtree") {
    return {
      scope: { kind: "pathSubtree", namespaces: canonical },
      additionalNamespaceCount: additionalCount,
      unscoped: false,
    };
  }
  if (mode === "scopeDag") {
    return {
      scope: { kind: "scopeDag", roots: canonical },
      additionalNamespaceCount: additionalCount,
      unscoped: false,
    };
  }
  return {
    scope: { kind: "exactScope", scopes: canonical },
    additionalNamespaceCount: additionalCount,
    unscoped: false,
  };
}
/** Hybrid lexical + vector retrieval as ordered `{ id: source_map_id, score }[]` (RRF). */
function rankSourceMapIdsForContent(
  persistence: MemoriesPersistence,
  caps: MemoriesBackendCapabilities,
  input: {
    scope: SearchNamespaceScope;
    logNamespace: string;
    content: SearchContent;
    lexicalWeight: number;
    vectorWeight: number;
    retrievalLimit: number;
    memoryIds?: string[];
    maxVectorDistance?: number;
    asOf?: SearchAsOf;
    vectorSearchMethod?: VectorSearchMethod;
  },
): { fused: Array<{ id: string; score: number }>; vectorSearchMethod?: VectorSearchMethod } {
  const { scope } = input;
  const asOfSpread = input.asOf !== undefined ? { asOf: input.asOf } : {};
  const resolvedMethod = resolveVectorSearchMethod(input.vectorSearchMethod, caps);
  let usedMethod: VectorSearchMethod | undefined;

  const multiRoots =
    scope.kind === "pathSubtree"
      ? scope.namespaces
      : scope.kind === "scopeDag"
        ? scope.roots
        : scope.kind === "exactScope"
          ? scope.scopes
          : [];

  const needsMultiArm =
    !caps.multiNamespaceSearch &&
    multiRoots.length > 1 &&
    (scope.kind === "pathSubtree" || scope.kind === "scopeDag" || scope.kind === "exactScope");

  const runVector = (subScope: SearchNamespaceScope): string[] => {
    if (!caps.vectorSearch || !("vector" in input.content) || input.vectorWeight <= 0) {
      return [];
    }
    if (resolvedMethod === undefined) return [];
    const result = persistence.searchVectorSourceMapIds({
      scope: subScope,
      vector: input.content.vector,
      limit: input.retrievalLimit,
      memoryIds: input.memoryIds,
      method: resolvedMethod,
      ...(input.maxVectorDistance !== undefined
        ? { maxVectorDistance: input.maxVectorDistance }
        : {}),
      ...asOfSpread,
    });
    if (result.vectorSearchMethod !== undefined) {
      usedMethod = result.vectorSearchMethod;
    }
    return result.sourceMapIds;
  };

  if (needsMultiArm) {
    const arms: RrfArm<string>[] = [];
    for (const ns of multiRoots) {
      const subScope: SearchNamespaceScope =
        scope.kind === "pathSubtree"
          ? pathSubtreeSingle(ns)
          : scope.kind === "scopeDag"
            ? { kind: "scopeDag", roots: [ns] }
            : { kind: "exactScope", scopes: [ns] };
      if (caps.lexicalSearch && "text" in input.content && input.lexicalWeight > 0) {
        const ranked = persistence.searchLexicalSourceMapIds({
          scope: subScope,
          text: input.content.text,
          limit: input.retrievalLimit,
          memoryIds: input.memoryIds,
          ...asOfSpread,
        });
        if (ranked.length > 0) {
          arms.push({ armId: `lexical:${ns}`, ranked, weight: input.lexicalWeight });
        }
      }
      const ranked = runVector(subScope);
      if (ranked.length > 0) {
        arms.push({ armId: `vector:${ns}`, ranked, weight: input.vectorWeight });
      }
    }
    if (arms.length === 0) return { fused: [], vectorSearchMethod: usedMethod };
    return {
      fused: fuseRrf(arms, { maxPerArm: input.retrievalLimit }),
      vectorSearchMethod: usedMethod,
    };
  }

  const arms: RrfArm<string>[] = [];
  if (caps.lexicalSearch && "text" in input.content && input.lexicalWeight > 0) {
    const ranked = persistence.searchLexicalSourceMapIds({
      scope,
      text: input.content.text,
      limit: input.retrievalLimit,
      memoryIds: input.memoryIds,
      ...asOfSpread,
    });
    if (ranked.length > 0) {
      arms.push({ armId: "lexical", ranked, weight: input.lexicalWeight });
    }
  }
  const ranked = runVector(scope);
  if (ranked.length > 0) {
    arms.push({ armId: "vector", ranked, weight: input.vectorWeight });
  }
  if (arms.length === 0) return { fused: [], vectorSearchMethod: usedMethod };
  return {
    fused: fuseRrf(arms, { maxPerArm: input.retrievalLimit }),
    vectorSearchMethod: usedMethod,
  };
}

function expandNeighborsWithSubSearch<NODE_LABELS extends string, EDGE_LABELS extends string>(
  persistence: MemoriesPersistence,
  caps: MemoriesBackendCapabilities,
  input: {
    namespace: NamespacePath;
    rootMemoryKey: string;
    rootGraph: MemoryGraphAssociation;
    content: SearchContent;
    lexicalWeight: number;
    vectorWeight: number;
    minScore: number;
    neighborFilters: NeighborFilter<EDGE_LABELS, NODE_LABELS> | undefined;
    maxNeighbors: number | undefined;
    maxVectorDistance?: number;
    asOf?: SearchAsOf;
    vectorSearchMethod?: VectorSearchMethod;
  },
): SearchNeighborHit<NODE_LABELS, EDGE_LABELS>[] {
  if (!caps.neighborIndex) return [];
  const graphNeighbors =
    input.rootGraph.kind === "edge"
      ? persistence.listNeighborsForEdgeMemory<EDGE_LABELS, NODE_LABELS>({
          namespace: input.namespace,
          edgeId: input.rootGraph.edge.edgeId,
          filters: input.neighborFilters,
        })
      : persistence.listNeighborsForMemory<EDGE_LABELS, NODE_LABELS>({
          namespace: input.namespace,
          key: input.rootMemoryKey,
          filters: input.neighborFilters,
        });

  const byMemoryId = new Map<string, HydratedNeighbor>();
  for (const n of graphNeighbors) {
    if (!byMemoryId.has(n._id)) {
      byMemoryId.set(n._id, n);
    }
  }

  const memoryIds = [...byMemoryId.keys()];
  if (memoryIds.length === 0) return [];
  if (input.maxNeighbors !== undefined && input.maxNeighbors === 0) return [];

  const capForRetrieval =
    input.maxNeighbors !== undefined && input.maxNeighbors >= 0
      ? input.maxNeighbors
      : Math.max(memoryIds.length, 10);
  const neighborRetrievalLimit = Math.max(capForRetrieval * 5, 25);

  const fusedResult = rankSourceMapIdsForContent(persistence, caps, {
    scope: pathSubtreeSingle(input.namespace),
    logNamespace: input.namespace,
    content: input.content,
    lexicalWeight: input.lexicalWeight,
    vectorWeight: input.vectorWeight,
    retrievalLimit: neighborRetrievalLimit,
    memoryIds,
    ...(input.maxVectorDistance !== undefined
      ? { maxVectorDistance: input.maxVectorDistance }
      : {}),
    ...(input.asOf !== undefined ? { asOf: input.asOf } : {}),
    ...(input.vectorSearchMethod !== undefined
      ? { vectorSearchMethod: input.vectorSearchMethod }
      : {}),
  });
  const fused = fusedResult.fused;

  if (fused.length === 0) return [];

  const hydrated = persistence.hydrateSourceMapHits(fused.map((r) => r.id));
  const hydratedById = new Map(hydrated.map((h) => [h._id, h]));

  const seenMemory = new Set<string>();
  const out: SearchNeighborHit<NODE_LABELS, EDGE_LABELS>[] = [];

  for (const result of fused) {
    if (result.score < input.minScore) continue;
    const hit = hydratedById.get(result.id);
    if (!hit) continue;
    const memId = hit.memory_id;
    if (seenMemory.has(memId)) continue;
    seenMemory.add(memId);

    const base = byMemoryId.get(memId);
    if (!base) continue;

    out.push({
      ...base,
      neighborScore: result.score,
      matchedSourceMapId: result.id,
    });
    if (
      input.maxNeighbors !== undefined &&
      input.maxNeighbors >= 0 &&
      out.length >= input.maxNeighbors
    ) {
      break;
    }
  }

  return out;
}

export function search<NODE_LABELS extends string = string, EDGE_LABELS extends string = string>(
  ctx: MutationCtx,
  params: SearchParams<NODE_LABELS, EDGE_LABELS>,
): SearchOutput<NODE_LABELS, EDGE_LABELS> {
  return runWithOpTelemetrySync({
    telemetry: ctx.telemetry,
    op: "search",
    namespace: params.namespace,
    getProvenanceRootHex: () => ctx.persistence.getProvenanceHeadRootHex() ?? "",
    successFields: (out) => ({ hitCount: out.hits.length }),
    fn: () => searchInner(ctx, params),
  });
}

function searchInner<NODE_LABELS extends string = string, EDGE_LABELS extends string = string>(
  ctx: MutationCtx,
  params: SearchParams<NODE_LABELS, EDGE_LABELS>,
): SearchOutput<NODE_LABELS, EDGE_LABELS> {
  const { persistence } = ctx;
  const caps = resolveMemoriesBackendCapabilities(persistence);
  const topK = params.options?.topK ?? 10;
  if (topK <= 0) return { hits: [] };

  const hasText = "text" in params.content;
  const hasVector = "vector" in params.content;
  if (!caps.lexicalSearch && !caps.vectorSearch) {
    return { hits: [] };
  }
  if (hasVector && !hasText && !caps.vectorSearch) {
    return { hits: [] };
  }
  if (hasText && !hasVector && !caps.lexicalSearch) {
    return { hits: [] };
  }

  const { scope } = normalizeSearchScopeFromParams(params, caps);

  const asOf = normalizeSearchAsOf({
    ...(params.asOf !== undefined ? { asOf: params.asOf } : {}),
    ...(params.asOfTimestampMs !== undefined ? { asOfTimestampMs: params.asOfTimestampMs } : {}),
  });
  if (asOf !== undefined && caps.asOfTimestampMsSearch !== true) {
    throw new Error(
      "SearchParams.asOf / asOfTimestampMs requires a persistence backend that sets capabilities.asOfTimestampMsSearch",
    );
  }

  const retrievalLimit = Math.max(topK * 5, 25);
  const lexicalWeight = params.options?.arms?.lexical ?? 1;
  const vectorWeight = params.options?.arms?.vector ?? 1;
  const maxVectorDistance = params.options?.maxVectorDistance;
  const vectorSearchMethod = params.options?.vectorSearchMethod;

  const { fused, vectorSearchMethod: usedMethod } = rankSourceMapIdsForContent(persistence, caps, {
    scope,
    logNamespace: params.namespace,
    content: params.content,
    lexicalWeight,
    vectorWeight,
    retrievalLimit,
    ...(maxVectorDistance !== undefined ? { maxVectorDistance } : {}),
    ...(asOf !== undefined ? { asOf } : {}),
    ...(vectorSearchMethod !== undefined ? { vectorSearchMethod } : {}),
  });
  if (fused.length === 0) {
    return usedMethod !== undefined ? { hits: [], vectorSearchMethod: usedMethod } : { hits: [] };
  }
  const hydrated = persistence.hydrateSourceMapHits(fused.map((result) => result.id));
  const hydratedById = new Map(hydrated.map((hit) => [hit._id, hit]));
  const minScore = params.options?.minScore ?? Number.NEGATIVE_INFINITY;

  const rootHits = fused
    .flatMap((result) => {
      const hit = hydratedById.get(result.id);
      if (!hit) return [];
      if (result.score < minScore) return [];
      if (!matchesLabelFilter(hit.labels, params.options?.labels)) return [];
      return [
        {
          ...hit,
          score: result.score,
        },
      ];
    })
    .slice(0, topK);

  const neighborOpt = !caps.neighborIndex ? false : params.options?.neighbors;
  if (neighborOpt === undefined || neighborOpt === false) {
    return usedMethod !== undefined
      ? { hits: rootHits, vectorSearchMethod: usedMethod }
      : { hits: rootHits };
  }

  const neighborFilters: NeighborFilter<EDGE_LABELS, NODE_LABELS> | undefined =
    neighborOpt === true ? undefined : neighborOpt;
  const maxNeighbors = params.options?.maxNeighbors;

  const withNeighbors = rootHits.map((hit) => ({
    ...hit,
    neighbors: expandNeighborsWithSubSearch<NODE_LABELS, EDGE_LABELS>(persistence, caps, {
      namespace: hit.memory.namespace,
      rootMemoryKey: hit.memory.key,
      rootGraph: hit.graph,
      content: params.content,
      lexicalWeight,
      vectorWeight,
      minScore,
      neighborFilters,
      maxNeighbors,
      ...(maxVectorDistance !== undefined ? { maxVectorDistance } : {}),
      ...(asOf !== undefined ? { asOf } : {}),
      ...(vectorSearchMethod !== undefined ? { vectorSearchMethod } : {}),
    }),
  }));
  return usedMethod !== undefined
    ? { hits: withNeighbors, vectorSearchMethod: usedMethod }
    : { hits: withNeighbors };
}
