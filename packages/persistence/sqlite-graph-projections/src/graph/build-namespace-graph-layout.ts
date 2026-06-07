import type { Database } from "bun:sqlite";
import type { MemoriesPersistence } from "@khoralabs/memories-core";
import { loadMeanEmbeddingsForNamespace } from "../mean-embeddings";
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

/**
 * Loads edges + mean embeddings + label/property sketches, runs UMAP 3D (or fallback),
 * returns normalized [-1,1]³ positions.
 */
export function buildNamespaceGraphLayout(
  db: Database,
  persistence: Pick<
    MemoriesPersistence,
    "loadGraphEdgesForNamespace" | "loadNodeLabelsForNamespace" | "loadNodePropertiesForNamespace"
  >,
  namespace: string,
  umapOptions?: Umap3DLayoutOptions,
): NamespaceGraphLayout {
  const edges = persistence.loadGraphEdgesForNamespace(namespace);
  const withEmb = loadMeanEmbeddingsForNamespace(db, namespace);
  const labelsByKey = persistence.loadNodeLabelsForNamespace(namespace);
  const propsByKey = persistence.loadNodePropertiesForNamespace(namespace);

  const keySet = new Set<string>();
  for (const e of edges) {
    keySet.add(e.fromKey);
    keySet.add(e.toKey);
  }
  for (const n of withEmb) {
    keySet.add(n.memoryKey);
  }

  const orderedKeys = [...keySet].sort();
  const embByKey = new Map(withEmb.map((e) => [e.memoryKey, e.embedding] as const));

  const rawPositions: Point3[] = [];

  if (orderedKeys.length === 0) {
    return {
      namespace,
      nodes: [],
      edges: edges.map((e) => ({
        edgeId: e.edgeId,
        fromKey: e.fromKey,
        toKey: e.toKey,
        labels: e.labels,
        directed: e.directed,
      })),
    };
  }

  let contentDim = 0;
  for (const e of withEmb) {
    if (e.embedding.length > 0) {
      contentDim = e.embedding.length;
      break;
    }
  }

  const buildCombinedEmbedding = (key: string): number[] => {
    const labels = labelsByKey.get(key) ?? [];
    const props = propsByKey.get(key) ?? null;
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

  if (withEmb.length === 0) {
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
    if (!p) return { key, x: 0, y: 0, z: 0, labels };
    return { key, x: p.x, y: p.y, z: p.z, labels };
  });

  const edgeRows: GraphLayoutEdge[] = edges.map((e) => ({
    edgeId: e.edgeId,
    fromKey: e.fromKey,
    toKey: e.toKey,
    labels: e.labels,
    directed: e.directed,
  }));

  return {
    namespace,
    nodes,
    edges: edgeRows,
  };
}
