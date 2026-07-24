import type {
  HydratedNeighbor,
  NamespacePath,
  NeighborFilter,
  OntologyLabelInstance,
} from "../../persistence/core";
import type {
  MemoriesBackendCapabilities,
  MemoriesPersistenceAsync,
  SearchNamespaceScope,
  VectorSearchMethod,
} from "../../persistence/core/persistence";
import {
  resolveMemoriesBackendCapabilities,
  resolveVectorSearchMethod,
} from "../../persistence/core/persistence";
import { runWithOpTelemetryAsync } from "../../telemetry/index.js";
import { fuseRrf, type RrfArm } from "../rrf/index.js";
import type { MutationCtxAsync } from "./merge-memory-async";
import {
  normalizeSearchScopeFromParams,
  type SearchContent,
  type SearchNeighborHit,
  type SearchOutput,
  type SearchParams,
} from "./search";

export type {
  NeighborSearchOption,
  SearchContent,
  SearchHit,
  SearchNeighborHit,
  SearchOutput,
  SearchParams,
} from "./search";

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

async function rankSourceMapIdsForContentAsync(
  persistence: MemoriesPersistenceAsync,
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
    asOfTimestampMs?: number;
    vectorSearchMethod?: VectorSearchMethod;
  },
): Promise<{
  fused: Array<{ id: string; score: number }>;
  vectorSearchMethod?: VectorSearchMethod;
}> {
  const { scope } = input;
  const asOf = input.asOfTimestampMs;
  const asOfSpread = asOf !== undefined ? { asOfTimestampMs: asOf } : {};
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

  const runVector = async (subScope: SearchNamespaceScope): Promise<string[]> => {
    if (!caps.vectorSearch || !("vector" in input.content) || input.vectorWeight <= 0) {
      return [];
    }
    if (resolvedMethod === undefined) return [];
    const result = await persistence.searchVectorSourceMapIds({
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
        const ranked = await persistence.searchLexicalSourceMapIds({
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
      const ranked = await runVector(subScope);
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
    const ranked = await persistence.searchLexicalSourceMapIds({
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
  const ranked = await runVector(scope);
  if (ranked.length > 0) {
    arms.push({ armId: "vector", ranked, weight: input.vectorWeight });
  }
  if (arms.length === 0) return { fused: [], vectorSearchMethod: usedMethod };
  return {
    fused: fuseRrf(arms, { maxPerArm: input.retrievalLimit }),
    vectorSearchMethod: usedMethod,
  };
}

async function expandNeighborsWithSubSearchAsync<
  NODE_LABELS extends string,
  EDGE_LABELS extends string,
>(
  persistence: MemoriesPersistenceAsync,
  caps: MemoriesBackendCapabilities,
  input: {
    namespace: NamespacePath;
    rootMemoryKey: string;
    content: SearchContent;
    lexicalWeight: number;
    vectorWeight: number;
    minScore: number;
    neighborFilters: NeighborFilter<EDGE_LABELS, NODE_LABELS> | undefined;
    maxNeighbors: number | undefined;
    maxVectorDistance?: number;
    asOfTimestampMs?: number;
    vectorSearchMethod?: VectorSearchMethod;
  },
): Promise<SearchNeighborHit<NODE_LABELS, EDGE_LABELS>[]> {
  if (!caps.neighborIndex) return [];
  const graphNeighbors = await persistence.listNeighborsForMemory<EDGE_LABELS, NODE_LABELS>({
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

  const fusedResult = await rankSourceMapIdsForContentAsync(persistence, caps, {
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
    ...(input.asOfTimestampMs !== undefined ? { asOfTimestampMs: input.asOfTimestampMs } : {}),
    ...(input.vectorSearchMethod !== undefined
      ? { vectorSearchMethod: input.vectorSearchMethod }
      : {}),
  });
  const fused = fusedResult.fused;

  if (fused.length === 0) return [];

  const hydrated = await persistence.hydrateSourceMapHits(fused.map((r) => r.id));
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

export async function searchAsync<
  NODE_LABELS extends string = string,
  EDGE_LABELS extends string = string,
>(
  ctx: MutationCtxAsync,
  params: SearchParams<NODE_LABELS, EDGE_LABELS>,
): Promise<SearchOutput<NODE_LABELS, EDGE_LABELS>> {
  return runWithOpTelemetryAsync({
    telemetry: ctx.telemetry,
    op: "search",
    namespace: params.namespace,
    getProvenanceRootHex: async () => (await ctx.persistence.getProvenanceHeadRootHex()) ?? "",
    successFields: (out) => ({ hitCount: out.hits.length }),
    fn: () => searchAsyncInner(ctx, params),
  });
}

async function searchAsyncInner<
  NODE_LABELS extends string = string,
  EDGE_LABELS extends string = string,
>(
  ctx: MutationCtxAsync,
  params: SearchParams<NODE_LABELS, EDGE_LABELS>,
): Promise<SearchOutput<NODE_LABELS, EDGE_LABELS>> {
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

  if (params.asOfTimestampMs !== undefined && caps.asOfTimestampMsSearch !== true) {
    throw new Error(
      "SearchParams.asOfTimestampMs requires a persistence backend that sets capabilities.asOfTimestampMsSearch",
    );
  }

  const retrievalLimit = Math.max(topK * 5, 25);
  const lexicalWeight = params.options?.arms?.lexical ?? 1;
  const vectorWeight = params.options?.arms?.vector ?? 1;
  const maxVectorDistance = params.options?.maxVectorDistance;
  const vectorSearchMethod = params.options?.vectorSearchMethod;

  const { fused, vectorSearchMethod: usedMethod } = await rankSourceMapIdsForContentAsync(
    persistence,
    caps,
    {
      scope,
      logNamespace: params.namespace,
      content: params.content,
      lexicalWeight,
      vectorWeight,
      retrievalLimit,
      ...(maxVectorDistance !== undefined ? { maxVectorDistance } : {}),
      ...(params.asOfTimestampMs !== undefined ? { asOfTimestampMs: params.asOfTimestampMs } : {}),
      ...(vectorSearchMethod !== undefined ? { vectorSearchMethod } : {}),
    },
  );
  if (fused.length === 0) {
    return usedMethod !== undefined ? { hits: [], vectorSearchMethod: usedMethod } : { hits: [] };
  }
  const hydrated = await persistence.hydrateSourceMapHits(fused.map((result) => result.id));
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

  const withNeighbors = await Promise.all(
    rootHits.map(async (hit) => ({
      ...hit,
      neighbors: await expandNeighborsWithSubSearchAsync<NODE_LABELS, EDGE_LABELS>(
        persistence,
        caps,
        {
          namespace: hit.memory.namespace,
          rootMemoryKey: hit.memory.key,
          content: params.content,
          lexicalWeight,
          vectorWeight,
          minScore,
          neighborFilters,
          maxNeighbors,
          ...(maxVectorDistance !== undefined ? { maxVectorDistance } : {}),
          ...(params.asOfTimestampMs !== undefined
            ? { asOfTimestampMs: params.asOfTimestampMs }
            : {}),
          ...(vectorSearchMethod !== undefined ? { vectorSearchMethod } : {}),
        },
      ),
    })),
  );
  return usedMethod !== undefined
    ? { hits: withNeighbors, vectorSearchMethod: usedMethod }
    : { hits: withNeighbors };
}
