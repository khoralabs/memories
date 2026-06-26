import type {
  GraphEdgeLink,
  GraphMemoryEmbedding,
  OntologyLabelInstance,
} from "@khoralabs/memories-core";
import type { GraphProjectionGraphReads, GraphProjectionSource } from "../source";
import { buildNamespaceGraphLayoutFromRows } from "./layout-core";
import type { GraphLayoutEdge, NamespaceGraphLayout } from "./layout-types";
import { qualifyMemoryKey } from "./qualified-memory-key";
import type { Umap3DLayoutOptions } from "./umap-layout";

function qualifyEdges(namespace: string, edges: GraphEdgeLink[]): GraphLayoutEdge[] {
  return edges.map((e) => ({
    edgeId: qualifyMemoryKey(namespace, e.edgeId),
    fromKey: qualifyMemoryKey(namespace, e.fromKey),
    toKey: qualifyMemoryKey(namespace, e.toKey),
    labels: e.labels,
    directed: e.directed,
  }));
}

function qualifyEmbeddings(
  namespace: string,
  rows: GraphMemoryEmbedding[],
): GraphMemoryEmbedding[] {
  return rows.map((row) => ({
    ...row,
    memoryKey: qualifyMemoryKey(namespace, row.memoryKey),
  }));
}

function qualifyLabelMap(
  namespace: string,
  rows: Map<string, OntologyLabelInstance[]>,
): Map<string, OntologyLabelInstance[]> {
  const out = new Map<string, OntologyLabelInstance[]>();
  for (const [key, labels] of rows) {
    out.set(qualifyMemoryKey(namespace, key), labels);
  }
  return out;
}

function qualifyPropertyMap(
  namespace: string,
  rows: Map<string, Record<string, unknown> | null>,
): Map<string, Record<string, unknown> | null> {
  const out = new Map<string, Record<string, unknown> | null>();
  for (const [key, props] of rows) {
    out.set(qualifyMemoryKey(namespace, key), props);
  }
  return out;
}

export async function buildNamespaceSubtreeGraphLayoutFromSource(
  source: GraphProjectionSource,
  persistence: GraphProjectionGraphReads,
  prefix: string,
  umapOptions?: Umap3DLayoutOptions,
): Promise<NamespaceGraphLayout> {
  const namespaces = await source.listNamespacesUnderPrefix(prefix);
  const chunks = await Promise.all(
    namespaces.map(async (namespace) => {
      const [edges, embeddings, labelsByKey, propertiesByKey] = await Promise.all([
        persistence.loadGraphEdgesForNamespace(namespace),
        source.loadMeanEmbeddingsForNamespace(namespace),
        persistence.loadNodeLabelsForNamespace(namespace),
        persistence.loadNodePropertiesForNamespace(namespace),
      ]);
      return {
        edges: qualifyEdges(namespace, edges),
        embeddings: qualifyEmbeddings(namespace, embeddings),
        labelsByKey: qualifyLabelMap(namespace, labelsByKey),
        propertiesByKey: qualifyPropertyMap(namespace, propertiesByKey),
      };
    }),
  );

  const labelsByKey = new Map<string, OntologyLabelInstance[]>();
  const propertiesByKey = new Map<string, Record<string, unknown> | null>();
  for (const chunk of chunks) {
    for (const [key, labels] of chunk.labelsByKey) labelsByKey.set(key, labels);
    for (const [key, props] of chunk.propertiesByKey) propertiesByKey.set(key, props);
  }

  return buildNamespaceGraphLayoutFromRows({
    namespace: prefix,
    edges: chunks.flatMap((chunk) => chunk.edges),
    embeddings: chunks.flatMap((chunk) => chunk.embeddings),
    labelsByKey,
    propertiesByKey,
    umapOptions,
  });
}
