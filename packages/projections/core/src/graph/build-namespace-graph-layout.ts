import type { GraphEdgeLink } from "@khoralabs/memories-core";
import type { GraphProjectionGraphReads, GraphProjectionSource } from "../source";
import { buildNamespaceGraphLayoutFromRows } from "./layout-core";
import type { GraphLayoutEdge, NamespaceGraphLayout } from "./layout-types";
import type { Umap3DLayoutOptions } from "./umap-layout";

function toLayoutEdge(edge: GraphEdgeLink): GraphLayoutEdge {
  return {
    edgeId: edge.edgeId,
    fromKey: edge.fromKey,
    toKey: edge.toKey,
    labels: edge.labels,
    directed: edge.directed,
  };
}

/**
 * Loads graph topology and projection source rows, then builds a normalized namespace layout.
 */
export async function buildNamespaceGraphLayoutFromSource(
  source: GraphProjectionSource,
  persistence: GraphProjectionGraphReads,
  namespace: string,
  umapOptions?: Umap3DLayoutOptions,
): Promise<NamespaceGraphLayout> {
  const [edges, embeddings, labelsByKey, propertiesByKey] = await Promise.all([
    persistence.loadGraphEdgesForNamespace(namespace),
    source.loadMeanEmbeddingsForNamespace(namespace),
    persistence.loadNodeLabelsForNamespace(namespace),
    persistence.loadNodePropertiesForNamespace(namespace),
  ]);

  return buildNamespaceGraphLayoutFromRows({
    namespace,
    edges: edges.map(toLayoutEdge),
    embeddings,
    labelsByKey,
    propertiesByKey,
    umapOptions,
  });
}
