import type { GraphMemoryEmbedding, OntologyLabelInstance } from "../../persistence/core";
import {
  LABEL_PROPERTY_SYNTH_DIM,
  labelPropertySyntheticEmbedding,
} from "./label-property-features";
import type { GraphLayoutEdge, GraphLayoutNode, NamespaceGraphLayout } from "./layout-types";
import {
  fibonacciSphereLayout3D,
  minMaxNormalize3D,
  type Point3,
  type Umap3DLayoutOptions,
  umap3DLayout,
} from "./umap-layout";

/** Scale of L2-normalized label/property sketch relative to content embedding coordinates. */
const LABEL_PROPERTY_SYNTH_WEIGHT = 0.22;

export type NamespaceGraphLayoutInput = {
  namespace: string;
  edges: GraphLayoutEdge[];
  embeddings: GraphMemoryEmbedding[];
  labelsByKey: Map<string, OntologyLabelInstance[]>;
  propertiesByKey: Map<string, Record<string, unknown> | null>;
  umapOptions?: Umap3DLayoutOptions;
  /**
   * When false (default), omit suppressed edges/keys from layout membership.
   * When true, layout all and mark `suppressed` on output nodes/edges.
   */
  includeSuppressed?: boolean;
  /** Node keys known suppressed (from umap input). Used with embedding.suppressed flags. */
  suppressedKeys?: readonly string[];
};

/** Undirected degree per key; self-loops count once. */
export function undirectedDegreeByKey(edges: readonly GraphLayoutEdge[]): Map<string, number> {
  const degreeByKey = new Map<string, number>();
  const bump = (key: string) => {
    degreeByKey.set(key, (degreeByKey.get(key) ?? 0) + 1);
  };
  for (const e of edges) {
    if (e.fromKey === e.toKey) {
      bump(e.fromKey);
      continue;
    }
    bump(e.fromKey);
    bump(e.toKey);
  }
  return degreeByKey;
}

export function buildNamespaceGraphLayoutFromRows({
  namespace,
  edges: inputEdges,
  embeddings: inputEmbeddings,
  labelsByKey,
  propertiesByKey,
  umapOptions,
  includeSuppressed = false,
  suppressedKeys = [],
}: NamespaceGraphLayoutInput): NamespaceGraphLayout {
  const suppressedKeySet = new Set(suppressedKeys);
  for (const emb of inputEmbeddings) {
    if (emb.suppressed === true) suppressedKeySet.add(emb.memoryKey);
  }

  const edges = includeSuppressed
    ? inputEdges
    : inputEdges.filter(
        (e) =>
          e.suppressed !== true &&
          !suppressedKeySet.has(e.fromKey) &&
          !suppressedKeySet.has(e.toKey),
      );
  const embeddings = includeSuppressed
    ? inputEmbeddings
    : inputEmbeddings.filter((e) => e.suppressed !== true && !suppressedKeySet.has(e.memoryKey));

  // Membership: edge endpoints ∪ embeddings ∪ keys with non-empty labels/properties.
  // Label/property loaders pre-seed every memory with [] / null — ignore those empties.
  const keySet = new Set<string>();
  for (const e of edges) {
    keySet.add(e.fromKey);
    keySet.add(e.toKey);
  }
  for (const n of embeddings) {
    keySet.add(n.memoryKey);
  }
  for (const [key, labels] of labelsByKey) {
    if (labels.length > 0) {
      if (!includeSuppressed && suppressedKeySet.has(key)) continue;
      keySet.add(key);
    }
  }
  for (const [key, props] of propertiesByKey) {
    if (props != null && Object.keys(props).length > 0) {
      if (!includeSuppressed && suppressedKeySet.has(key)) continue;
      keySet.add(key);
    }
  }

  const orderedKeys = [...keySet].sort();
  const embByKey = new Map(embeddings.map((e) => [e.memoryKey, e.embedding] as const));
  const degreeByKey = undirectedDegreeByKey(edges);
  let maxDegree = 0;
  for (const key of orderedKeys) {
    maxDegree = Math.max(maxDegree, degreeByKey.get(key) ?? 0);
  }

  const rawPositions: Point3[] = [];

  const layoutEdges: GraphLayoutEdge[] = includeSuppressed
    ? edges.map((e) =>
        e.suppressed === true || suppressedKeySet.has(e.fromKey) || suppressedKeySet.has(e.toKey)
          ? { ...e, suppressed: true }
          : e,
      )
    : edges;

  if (orderedKeys.length === 0) {
    return {
      namespace,
      nodes: [],
      edges: layoutEdges,
    };
  }

  let contentDim = 0;
  for (const e of embeddings) {
    if (e.embedding.length > 0) {
      contentDim = e.embedding.length;
      break;
    }
  }

  const buildCombinedEmbedding = (key: string): number[] => {
    const labels = labelsByKey.get(key) ?? [];
    const props = propertiesByKey.get(key) ?? null;
    const synth = labelPropertySyntheticEmbedding(labels, props, LABEL_PROPERTY_SYNTH_DIM).map(
      (x) => x * LABEL_PROPERTY_SYNTH_WEIGHT,
    );
    if (contentDim === 0) {
      return synth;
    }
    const mean = embByKey.get(key);
    const meanPart = new Array(contentDim).fill(0);
    if (mean && mean.length === contentDim) {
      for (let i = 0; i < contentDim; i++) {
        meanPart[i] = mean[i] ?? 0;
      }
    }
    return [...meanPart, ...synth];
  };

  if (embeddings.length === 0) {
    const rows = orderedKeys.map(buildCombinedEmbedding);
    const dim = rows[0]?.length ?? 0;
    if (dim === 0) {
      rawPositions.push(...fibonacciSphereLayout3D(orderedKeys.length));
    } else {
      rawPositions.push(...umap3DLayout(rows, umapOptions));
    }
  } else {
    const embeddingRows = orderedKeys.map(buildCombinedEmbedding);
    rawPositions.push(...umap3DLayout(embeddingRows, umapOptions));
  }

  const normalized = minMaxNormalize3D(rawPositions);
  const nodes: GraphLayoutNode[] = orderedKeys.map((key, i) => {
    const p = normalized[i];
    const labels = labelsByKey.get(key) ?? [];
    const count = degreeByKey.get(key) ?? 0;
    const degree = {
      count,
      centrality: maxDegree === 0 ? 0 : count / maxDegree,
    };
    const suppressed =
      includeSuppressed && suppressedKeySet.has(key)
        ? ({ suppressed: true as const } as const)
        : {};
    if (!p) return { key, x: 0, y: 0, z: 0, labels, degree, ...suppressed };
    return { key, x: p.x, y: p.y, z: p.z, labels, degree, ...suppressed };
  });

  return {
    namespace,
    nodes,
    edges: layoutEdges,
  };
}
