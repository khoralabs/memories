import type { Database } from "bun:sqlite";
import type { MemoriesPersistence, OntologyLabelInstance } from "@khoralabs/memories-core";
import { listNamespacesUnderPrefix } from "../models/list-namespaces-under-prefix";
import { loadMeanEmbeddingsForNamespace } from "../visualization/projection";
import {
  LABEL_PROPERTY_SYNTH_DIM,
  labelPropertySyntheticEmbedding,
} from "./label-property-features";
import type { GraphLayoutEdge, GraphLayoutNode, NamespaceGraphLayout } from "./layout-types";
import { qualifyMemoryKey } from "./qualified-memory-key";
import {
  fibonacciSphereLayout3D,
  minMaxNormalize3D,
  type Point3,
  type Umap3DLayoutOptions,
  umap3DLayout,
} from "./umap-layout";

const LABEL_PROPERTY_SYNTH_WEIGHT = 0.22;

/**
 * Merges graph data from all namespaces under `prefix`, using qualified node keys
 * (`namespace::memoryKey`) to avoid collisions across namespaces.
 */
export function buildNamespaceSubtreeGraphLayout(
  db: Database,
  persistence: Pick<
    MemoriesPersistence,
    "loadGraphEdgesForNamespace" | "loadNodeLabelsForNamespace" | "loadNodePropertiesForNamespace"
  >,
  prefix: string,
  umapOptions?: Umap3DLayoutOptions,
): NamespaceGraphLayout {
  const namespaces = listNamespacesUnderPrefix(db, prefix);
  const edges: GraphLayoutEdge[] = [];
  const labelsByKey = new Map<string, OntologyLabelInstance[]>();
  const propsByKey = new Map<string, Record<string, unknown> | null>();
  const embByKey = new Map<string, number[]>();

  for (const ns of namespaces) {
    for (const e of persistence.loadGraphEdgesForNamespace(ns)) {
      edges.push({
        edgeId: e.edgeId,
        fromKey: qualifyMemoryKey(ns, e.fromKey),
        toKey: qualifyMemoryKey(ns, e.toKey),
        labels: e.labels,
        directed: e.directed,
      });
    }
    for (const row of loadMeanEmbeddingsForNamespace(db, ns)) {
      embByKey.set(qualifyMemoryKey(ns, row.memoryKey), row.embedding);
    }
    for (const [k, v] of persistence.loadNodeLabelsForNamespace(ns)) {
      labelsByKey.set(qualifyMemoryKey(ns, k), v);
    }
    for (const [k, v] of persistence.loadNodePropertiesForNamespace(ns)) {
      propsByKey.set(qualifyMemoryKey(ns, k), v);
    }
  }

  const keySet = new Set<string>();
  for (const e of edges) {
    keySet.add(e.fromKey);
    keySet.add(e.toKey);
  }
  for (const k of embByKey.keys()) {
    keySet.add(k);
  }

  const orderedKeys = [...keySet].sort();

  if (orderedKeys.length === 0) {
    return { namespace: prefix, nodes: [], edges };
  }

  let contentDim = 0;
  for (const emb of embByKey.values()) {
    if (emb.length > 0) {
      contentDim = emb.length;
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

  const embeddingRows = orderedKeys.map(buildCombinedEmbedding);
  let rawPositions: Point3[];
  if (embByKey.size === 0) {
    const dim = embeddingRows[0]?.length ?? 0;
    rawPositions =
      dim === 0
        ? fibonacciSphereLayout3D(orderedKeys.length)
        : umap3DLayout(embeddingRows, umapOptions);
  } else {
    rawPositions = umap3DLayout(embeddingRows, umapOptions);
  }

  const normalized = minMaxNormalize3D(rawPositions);
  const nodes: GraphLayoutNode[] = orderedKeys.map((key, i) => {
    const p = normalized[i];
    const labels = labelsByKey.get(key) ?? [];
    if (!p) return { key, x: 0, y: 0, z: 0, labels };
    return { key, x: p.x, y: p.y, z: p.z, labels };
  });

  return { namespace: prefix, nodes, edges };
}
