/**
 * Namespace-scoped semantic deduplication for a memories database.
 *
 * Inspired by / adapted from:
 * Abbas et al., *SemDeDup: Data-efficient learning at web-scale through semantic
 * deduplication*, arXiv:2303.09540v3 — https://arxiv.org/abs/2303.09540
 *
 * Paper algorithm (applied here): embed → k-means partition → intra-cluster
 * pairwise cosine ≥ `1 − ε` → keep one per **connected component** (single-linkage
 * over the threshold graph; intentional SemDeDup §3 — not complete-linkage).
 *
 * Memories adaptations (deliberate deviations from the paper):
 * - Unit = memory (mean of non-system source_map vectors), not one embedding per doc
 * - Survivor = newest content / longest text / stable id (not farthest-from-centroid)
 * - Action = suppress (reversible), not drop-from-train-set
 * - Optional loose-ε candidate band + lexical Jaccard confirm before auto-suppress
 */

import type { MemoriesPersistence } from "../../persistence/core/persistence";
import { isSystemSearchMetaSourceKey } from "../../persistence/core/search-meta-constants";
import { runWithOpTelemetrySync } from "../../telemetry/index.js";
import type { MutationCtx } from "../api/merge-memory";
import { suppressMemoryInTransaction } from "../models/suppress-memory";

/** Short paper id for docs and provenance (`intentSnapshotId`). */
export const SEMDEDUP_PAPER = "arXiv:2303.09540" as const;

/** Canonical abs URL for SemDeDup. */
export const SEMDEDUP_PAPER_URL = "https://arxiv.org/abs/2303.09540" as const;

/** Human-readable citation. */
export const SEMDEDUP_CITATION =
  "Abbas et al., SemDeDup: Data-efficient learning at web-scale through semantic deduplication, arXiv:2303.09540v3" as const;

const INVENTORY_LIMIT = 10_000;
const KMEANS_MAX_ITERS = 40;
const DEFAULT_MIN_LEXICAL_JACCARD = 0.1;

export type SemanticDedupMemoryRef = {
  memoryId: string;
  key: string;
};

/** One memory row ready for SemDeDup (mean-pooled, L2-normalized embedding). */
export type SemanticDedupItem = {
  memoryId: string;
  key: string;
  embedding: number[];
  /** Max non-system source_map `_ts_created` (last indexed content). */
  createdAt: number;
  textLength: number;
  text: string;
};

export type SemanticDedupGroup = {
  keep: SemanticDedupMemoryRef;
  drop: SemanticDedupMemoryRef[];
  /** Max pairwise cosine similarity observed in the group. */
  score: number;
  band: "tight" | "loose";
  textPreviews?: Record<string, string>;
};

export type PlanSemanticDedupParams = {
  namespace: string;
  /**
   * Dissimilarity threshold ε from SemDeDup: pairs with cosine similarity ≥ `1 − ε`
   * are semantic duplicates (tight / auto-suppress band).
   */
  epsilon?: number;
  /**
   * Looser ε (should be > `epsilon`). Groups at this threshold that are not already in
   * the tight band are reported as `band: "loose"` candidates only (never auto-applied).
   * If ≤ `epsilon` (e.g. after calibration), it is lifted to `epsilon + 1e-6`.
   */
  looseEpsilon?: number;
  /** Override k-means cluster count. Default ≈ `max(16, min(N/32, √N))` capped by N. */
  k?: number;
  mode: "plan" | "apply";
  /** v1 only: suppress losers. */
  action?: "suppress";
  /**
   * When set (and `epsilon` omitted), calibrate ε on a cluster sample to approximate
   * this keep fraction (paper §6.5).
   */
  targetKeepFraction?: number;
  /**
   * Min token Jaccard between texts for a tight-band pair to count (FP guard).
   * Default `0.1`; set `0` to disable.
   */
  minLexicalJaccard?: number;
  /** RNG seed for k-means init (tests). */
  seed?: number;
};

export type PlanSemanticDedupResult = {
  namespace: string;
  epsilon: number;
  looseEpsilon?: number;
  k: number;
  itemCount: number;
  groups: SemanticDedupGroup[];
  /** Memories suppressed in `apply` mode. */
  applied: number;
  paper: typeof SEMDEDUP_PAPER;
};

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function l2Normalize(v: number[]): number[] {
  let s = 0;
  for (const x of v) s += x * x;
  const n = Math.sqrt(s);
  if (!(n > 0)) return v.map(() => 0);
  return v.map((x) => x / n);
}

/** Cosine similarity for L2-normalized vectors (dot product). */
export function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < n; i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
  }
  return dot;
}

function tokenize(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.toLowerCase().match(/[a-z0-9_]+/g) ?? []) {
    if (m.length >= 1) out.add(m);
  }
  return out;
}

/** Token Jaccard overlap; empty∩empty → 1 so vector-only items can still match. */
export function lexicalJaccard(a: string, b: string): number {
  const A = tokenize(a);
  const B = tokenize(b);
  if (A.size === 0 && B.size === 0) return 1;
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  return inter / (A.size + B.size - inter);
}

/**
 * Default cluster count: same complexity tradeoff as SemDeDup (§3, §6.1) scaled for
 * typical memories DB sizes (paper used 10k–50k for hundreds of millions of rows).
 */
export function defaultSemDeDupK(n: number): number {
  if (n <= 1) return 1;
  const bySqrt = Math.max(1, Math.floor(Math.sqrt(n)));
  const byRatio = Math.max(1, Math.floor(n / 32));
  // Plan / SemDeDup tradeoff: k ≈ max(16, min(N/32, √N)), clamped to [1, N].
  const raw = Math.max(16, Math.min(byRatio, bySqrt));
  return Math.max(1, Math.min(n, raw));
}

/**
 * Mean-pool non-system vectors per memory (same exclusion as
 * {@link loadMeanEmbeddingsForNamespace}), plus text / recency for survivor policy.
 */
export function loadSemanticDedupItems(
  persistence: MemoriesPersistence,
  namespace: string,
): SemanticDedupItem[] {
  if (persistence.isNamespaceSuppressed(namespace)) return [];

  const keys = persistence.listMemoryKeysInNamespace(namespace);
  const items: SemanticDedupItem[] = [];
  let dim: number | undefined;

  for (const key of keys) {
    const memoryId = persistence.findMemoryIdByKey(namespace, key);
    if (memoryId === undefined) continue;
    if (persistence.isMemorySuppressed(memoryId)) continue;

    const inventory = persistence.listSourceMapInventoryForMemory(memoryId, INVENTORY_LIMIT);
    const vectorMaps = inventory.filter(
      (sm) => sm.hasVector && !isSystemSearchMetaSourceKey(sm.sourceKey),
    );
    if (vectorMaps.length === 0) continue;

    const sums: number[] = [];
    let count = 0;
    let createdAt = 0;
    for (const sm of vectorMaps) {
      const vec = persistence.getSourceMapVector(sm.sourceMapId);
      if (vec === null || vec.length === 0) continue;
      if (dim === undefined) dim = vec.length;
      else if (vec.length !== dim) {
        throw new Error(
          `semantic-dedup: mixed embedding dimensions in namespace ${namespace} (${dim} vs ${vec.length})`,
        );
      }
      if (sums.length === 0) {
        for (let i = 0; i < vec.length; i++) sums.push(vec[i] ?? 0);
      } else {
        for (let i = 0; i < vec.length; i++) sums[i] = (sums[i] ?? 0) + (vec[i] ?? 0);
      }
      count += 1;
      if (sm.createdAt > createdAt) createdAt = sm.createdAt;
    }
    if (count === 0) continue;

    const textRows = persistence
      .listTextFeatureExportRowsForMemory(memoryId)
      .filter((r) => !isSystemSearchMetaSourceKey(r.source_key));
    const text = textRows.map((r) => r.text).join("\n\n");
    const embedding = l2Normalize(sums.map((s) => s / count));
    items.push({
      memoryId,
      key,
      embedding,
      createdAt,
      textLength: text.length,
      text,
    });
  }

  return items;
}

/** SemDeDup §3: k-means in embedding space. */
export function kMeansAssign(
  embeddings: number[][],
  k: number,
  opts?: { maxIters?: number; seed?: number },
): { assignments: number[]; centroids: number[][] } {
  const n = embeddings.length;
  const dim = embeddings[0]?.length ?? 0;
  if (n === 0 || dim === 0) return { assignments: [], centroids: [] };
  const kk = Math.max(1, Math.min(k, n));
  const rand = mulberry32(opts?.seed ?? 1);
  const maxIters = opts?.maxIters ?? KMEANS_MAX_ITERS;

  const centroids: number[][] = [];
  const used = new Set<number>();
  while (centroids.length < kk) {
    const i = Math.floor(rand() * n);
    if (used.has(i)) continue;
    used.add(i);
    centroids.push([...(embeddings[i] ?? [])]);
  }

  const assignments = new Array<number>(n).fill(0);
  for (let iter = 0; iter < maxIters; iter++) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      const emb = embeddings[i] ?? [];
      let best = 0;
      let bestSim = -Infinity;
      for (let c = 0; c < kk; c++) {
        const sim = cosineSimilarity(emb, centroids[c] ?? []);
        if (sim > bestSim) {
          bestSim = sim;
          best = c;
        }
      }
      if (assignments[i] !== best) {
        assignments[i] = best;
        changed = true;
      }
    }

    const sums = Array.from({ length: kk }, () => new Array<number>(dim).fill(0));
    const counts = new Array<number>(kk).fill(0);
    for (let i = 0; i < n; i++) {
      const c = assignments[i] ?? 0;
      const emb = embeddings[i] ?? [];
      counts[c] = (counts[c] ?? 0) + 1;
      const sum = sums[c];
      if (!sum) continue;
      for (let d = 0; d < dim; d++) sum[d] = (sum[d] ?? 0) + (emb[d] ?? 0);
    }
    for (let c = 0; c < kk; c++) {
      const cnt = counts[c] ?? 0;
      if (cnt === 0) continue;
      const sum = sums[c];
      if (!sum) continue;
      centroids[c] = l2Normalize(sum.map((s) => s / cnt));
    }
    if (!changed && iter > 0) break;
  }

  return { assignments, centroids };
}

function compareSurvivors(a: SemanticDedupItem, b: SemanticDedupItem): number {
  // Newest content first (memories adaptation; paper keeps farthest-from-centroid).
  if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;
  if (a.textLength !== b.textLength) return b.textLength - a.textLength;
  return a.memoryId.localeCompare(b.memoryId);
}

function connectedComponents(
  indices: number[],
  isEdge: (i: number, j: number) => boolean,
): number[][] {
  // Single-linkage / Union-Find over edges with sim ≥ 1−ε (SemDeDup threshold graph).
  const parent = new Map<number, number>();
  const find = (x: number): number => {
    let p = parent.get(x) ?? x;
    if (p !== x) {
      p = find(p);
      parent.set(x, p);
    }
    return p;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const i of indices) parent.set(i, i);
  for (let a = 0; a < indices.length; a++) {
    const i = indices[a];
    if (i === undefined) continue;
    for (let b = a + 1; b < indices.length; b++) {
      const j = indices[b];
      if (j === undefined) continue;
      if (isEdge(i, j)) union(i, j);
    }
  }
  const buckets = new Map<number, number[]>();
  for (const i of indices) {
    const r = find(i);
    const list = buckets.get(r);
    if (list) list.push(i);
    else buckets.set(r, [i]);
  }
  return [...buckets.values()];
}

function buildGroupsForEpsilon(
  items: SemanticDedupItem[],
  assignments: number[],
  k: number,
  epsilon: number,
  opts: {
    band: "tight" | "loose";
    minLexicalJaccard: number;
    excludeKeys?: Set<string>;
  },
): SemanticDedupGroup[] {
  const threshold = 1 - epsilon;
  const groups: SemanticDedupGroup[] = [];
  const byCluster = Array.from({ length: k }, () => [] as number[]);
  for (let i = 0; i < items.length; i++) {
    const c = assignments[i] ?? 0;
    byCluster[c]?.push(i);
  }

  for (const memberIdxs of byCluster) {
    if (memberIdxs.length < 2) continue;

    const pairScore = new Map<string, number>();
    const isEdge = (i: number, j: number): boolean => {
      const a = items[i];
      const b = items[j];
      if (!a || !b) return false;
      if (opts.excludeKeys?.has(a.key) || opts.excludeKeys?.has(b.key)) return false;
      const sim = cosineSimilarity(a.embedding, b.embedding);
      if (sim < threshold) return false;
      if (opts.band === "tight" && opts.minLexicalJaccard > 0) {
        if (lexicalJaccard(a.text, b.text) < opts.minLexicalJaccard) return false;
      }
      const key = i < j ? `${i}:${j}` : `${j}:${i}`;
      pairScore.set(key, sim);
      return true;
    };

    const components = connectedComponents(memberIdxs, isEdge);
    for (const comp of components) {
      if (comp.length < 2) continue;
      const members = comp.flatMap((i) => {
        const item = items[i];
        return item ? [item] : [];
      });
      if (members.length < 2) continue;
      members.sort(compareSurvivors);
      const keepItem = members[0];
      if (!keepItem) continue;
      const dropItems = members.slice(1);
      let score = 0;
      for (let a = 0; a < comp.length; a++) {
        for (let b = a + 1; b < comp.length; b++) {
          const i = comp[a];
          const j = comp[b];
          if (i === undefined || j === undefined) continue;
          const key = i < j ? `${i}:${j}` : `${j}:${i}`;
          const ei = items[i]?.embedding;
          const ej = items[j]?.embedding;
          if (ei === undefined || ej === undefined) continue;
          const s = pairScore.get(key) ?? cosineSimilarity(ei, ej);
          if (s > score) score = s;
        }
      }
      const textPreviews: Record<string, string> = {};
      for (const m of members) {
        textPreviews[m.key] = m.text.length > 240 ? `${m.text.slice(0, 239)}…` : m.text;
      }
      groups.push({
        keep: { memoryId: keepItem.memoryId, key: keepItem.key },
        drop: dropItems.map((d) => ({ memoryId: d.memoryId, key: d.key })),
        score,
        band: opts.band,
        textPreviews,
      });
    }
  }

  return groups;
}

function keepFractionForEpsilon(
  items: SemanticDedupItem[],
  assignments: number[],
  k: number,
  epsilon: number,
  minLexicalJaccard: number,
): number {
  if (items.length === 0) return 1;
  const groups = buildGroupsForEpsilon(items, assignments, k, epsilon, {
    band: "tight",
    minLexicalJaccard,
  });
  const drop = new Set<string>();
  for (const g of groups) for (const d of g.drop) drop.add(d.key);
  return (items.length - drop.size) / items.length;
}

/**
 * SemDeDup §6.5: tune ε on a cluster sample toward a target keep fraction.
 */
export function calibrateSemanticDedupEpsilon(
  items: SemanticDedupItem[],
  targetKeepFraction: number,
  opts?: { k?: number; seed?: number; minLexicalJaccard?: number; sampleFraction?: number },
): number {
  if (!(targetKeepFraction > 0 && targetKeepFraction <= 1)) {
    throw new RangeError("targetKeepFraction must be in (0, 1]");
  }
  if (items.length < 2) return 0;

  const k = opts?.k ?? defaultSemDeDupK(items.length);
  const { assignments } = kMeansAssign(
    items.map((i) => i.embedding),
    k,
    { seed: opts?.seed },
  );
  const minLex = opts?.minLexicalJaccard ?? DEFAULT_MIN_LEXICAL_JACCARD;
  const sampleFraction = opts?.sampleFraction ?? 0.1;

  // Sample ~10% of clusters (paper §6.5); seeded shuffle so sample is not insertion-order biased.
  const clusterIds = [...new Set(assignments)];
  const rand = mulberry32(opts?.seed ?? 1);
  for (let i = clusterIds.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const a = clusterIds[i];
    const b = clusterIds[j];
    if (a === undefined || b === undefined) continue;
    clusterIds[i] = b;
    clusterIds[j] = a;
  }
  const sampleCount = Math.max(
    1,
    Math.min(clusterIds.length, Math.ceil(clusterIds.length * sampleFraction)),
  );
  const sampleClusters = new Set(clusterIds.slice(0, sampleCount));
  const sampleIdx: number[] = [];
  const sampleAssign: number[] = [];
  const remap = new Map<number, number>();
  let next = 0;
  for (let i = 0; i < items.length; i++) {
    const c = assignments[i] ?? 0;
    if (!sampleClusters.has(c)) continue;
    sampleIdx.push(i);
    let m = remap.get(c);
    if (m === undefined) {
      m = next++;
      remap.set(c, m);
    }
    sampleAssign.push(m);
  }
  const sampleItems = sampleIdx.flatMap((i) => {
    const item = items[i];
    return item ? [item] : [];
  });
  const sampleK = Math.max(1, next);

  let lo = 1e-6;
  let hi = 1;
  for (let iter = 0; iter < 32; iter++) {
    const mid = (lo + hi) / 2;
    const keep = keepFractionForEpsilon(sampleItems, sampleAssign, sampleK, mid, minLex);
    if (keep > targetKeepFraction) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

function buildIntentSnapshotId(input: { epsilon: number; peerKey: string }): string {
  return `semdedup|SemDeDup|${SEMDEDUP_PAPER}|eps=${input.epsilon}|peer=${input.peerKey}`;
}

/**
 * Plan or apply SemDeDup-style semantic deduplication within one primary namespace.
 *
 * @see SEMDEDUP_CITATION
 */
export function planSemanticDedup(
  ctx: MutationCtx,
  params: PlanSemanticDedupParams,
): PlanSemanticDedupResult {
  const action = params.action ?? "suppress";
  if (action !== "suppress") {
    throw new Error(`semantic-dedup: unsupported action ${String(action)}`);
  }
  if (params.mode !== "plan" && params.mode !== "apply") {
    throw new Error(`semantic-dedup: mode must be "plan" or "apply"`);
  }

  const items = loadSemanticDedupItems(ctx.persistence, params.namespace);
  const minLexicalJaccard = params.minLexicalJaccard ?? DEFAULT_MIN_LEXICAL_JACCARD;

  let epsilon = params.epsilon;
  if (epsilon === undefined) {
    if (params.targetKeepFraction === undefined) {
      throw new Error("semantic-dedup: provide epsilon or targetKeepFraction");
    }
    epsilon = calibrateSemanticDedupEpsilon(items, params.targetKeepFraction, {
      k: params.k,
      seed: params.seed,
      minLexicalJaccard,
    });
  }
  if (!(epsilon >= 0)) throw new RangeError("epsilon must be >= 0");

  let looseEpsilon = params.looseEpsilon;
  if (looseEpsilon !== undefined && !(looseEpsilon > epsilon)) {
    // Calibrated ε can land ≥ a fixed looseEpsilon; lift the loose band instead of crashing.
    looseEpsilon = epsilon + 1e-6;
  }

  const k = params.k ?? defaultSemDeDupK(items.length);
  const { assignments } = kMeansAssign(
    items.map((i) => i.embedding),
    k,
    { seed: params.seed },
  );
  const kk = Math.max(1, Math.min(k, Math.max(1, items.length)));

  // SemDeDup: intra-cluster pairs with sim ≥ 1−ε form duplicate groups; keep one.
  const tightGroups = buildGroupsForEpsilon(items, assignments, kk, epsilon, {
    band: "tight",
    minLexicalJaccard,
  });

  const tightKeys = new Set<string>();
  for (const g of tightGroups) {
    tightKeys.add(g.keep.key);
    for (const d of g.drop) tightKeys.add(d.key);
  }

  const looseGroups =
    looseEpsilon !== undefined
      ? buildGroupsForEpsilon(items, assignments, kk, looseEpsilon, {
          band: "loose",
          minLexicalJaccard: 0,
          excludeKeys: tightKeys,
        })
      : [];

  const groups = [...tightGroups, ...looseGroups];
  let applied = 0;

  if (params.mode === "apply") {
    const drops: { key: string; peerKey: string }[] = [];
    for (const g of tightGroups) {
      for (const d of g.drop) drops.push({ key: d.key, peerKey: g.keep.key });
    }
    if (drops.length > 0) {
      ctx.persistence.withTransaction(() => {
        for (const d of drops) {
          const didApply = runWithOpTelemetrySync({
            telemetry: ctx.telemetry,
            op: "suppress",
            namespace: params.namespace,
            memoryKey: d.key,
            getProvenanceRootHex: () => ctx.persistence.getProvenanceHeadRootHex() ?? "",
            fn: () =>
              suppressMemoryInTransaction(ctx, {
                namespace: params.namespace,
                key: d.key,
                attribution: {
                  intentSnapshotId: buildIntentSnapshotId({
                    epsilon,
                    peerKey: d.peerKey,
                  }),
                },
              }),
          });
          if (didApply) applied += 1;
        }
      });
    }
  }

  return {
    namespace: params.namespace,
    epsilon,
    ...(looseEpsilon !== undefined ? { looseEpsilon } : {}),
    k: kk,
    itemCount: items.length,
    groups,
    applied,
    paper: SEMDEDUP_PAPER,
  };
}
