import type { Database } from "bun:sqlite";
import type {
  EdgePreviewPayload,
  GraphEdgeLink,
  GraphMemoryEmbedding,
  MemoriesPersistence,
  OntologyLabelInstance,
} from "@khoralabs/memories-core";
import {
  buildNamespaceGraphLayoutFromRows,
  type GraphLayoutEdge,
  type NamespaceGraphLayout,
  qualifyMemoryKey,
  type Umap3DLayoutOptions,
} from "@khoralabs/memories-projections";
import { listNamespacesUnderPrefix } from "@khoralabs/memories-sqlite";
import {
  createSqliteGraphProjectionSource,
  loadMeanEmbeddingsForNamespace,
  loadMemoryTextPreview,
  loadSourceMapTextPreview,
} from "./source";

export {
  buildNamespaceGraphLayoutFromSource,
  buildNamespaceSubtreeGraphLayoutFromSource,
  createMemoriesVisualizationFromSource,
  createSeededRandom,
  DEFAULT_UMAP_LAYOUT_SEED,
  fibonacciSphereLayout3D,
  type GraphLayoutEdge,
  type GraphLayoutNode,
  type GraphProjectionSource,
  LABEL_PROPERTY_SYNTH_DIM,
  labelPropertySyntheticEmbedding,
  minMaxNormalize3D,
  type NamespaceGraphLayout,
  type Point3,
  QUALIFIED_MEMORY_KEY_SEP,
  qualifyMemoryKey,
  type Umap3DLayoutOptions,
  umap3DLayout,
} from "@khoralabs/memories-projections";
export {
  createSqliteGraphProjectionSource,
  loadMeanEmbeddingsForNamespace,
  loadMemoryTextPreview,
  loadSourceMapTextPreview,
};

function toLayoutEdge(edge: GraphEdgeLink): GraphLayoutEdge {
  return {
    edgeId: edge.edgeId,
    fromKey: edge.fromKey,
    toKey: edge.toKey,
    labels: edge.labels,
    directed: edge.directed,
  };
}

export function buildNamespaceGraphLayout(
  db: Database,
  persistence: Pick<
    MemoriesPersistence,
    "loadGraphEdgesForNamespace" | "loadNodeLabelsForNamespace" | "loadNodePropertiesForNamespace"
  >,
  namespace: string,
  umapOptions?: Umap3DLayoutOptions,
): NamespaceGraphLayout {
  return buildNamespaceGraphLayoutFromRows({
    namespace,
    edges: persistence.loadGraphEdgesForNamespace(namespace).map(toLayoutEdge),
    embeddings: loadMeanEmbeddingsForNamespace(db, namespace),
    labelsByKey: persistence.loadNodeLabelsForNamespace(namespace),
    propertiesByKey: persistence.loadNodePropertiesForNamespace(namespace),
    umapOptions,
  });
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
  const embeddings: GraphMemoryEmbedding[] = [];
  const labelsByKey = new Map<string, OntologyLabelInstance[]>();
  const propertiesByKey = new Map<string, Record<string, unknown> | null>();

  for (const namespace of namespaces) {
    for (const edge of persistence.loadGraphEdgesForNamespace(namespace)) {
      edges.push({
        edgeId: qualifyMemoryKey(namespace, edge.edgeId),
        fromKey: qualifyMemoryKey(namespace, edge.fromKey),
        toKey: qualifyMemoryKey(namespace, edge.toKey),
        labels: edge.labels,
        directed: edge.directed,
      });
    }
    embeddings.push(...qualifyEmbeddings(namespace, loadMeanEmbeddingsForNamespace(db, namespace)));
    for (const [key, labels] of qualifyLabelMap(
      namespace,
      persistence.loadNodeLabelsForNamespace(namespace),
    )) {
      labelsByKey.set(key, labels);
    }
    for (const [key, props] of qualifyPropertyMap(
      namespace,
      persistence.loadNodePropertiesForNamespace(namespace),
    )) {
      propertiesByKey.set(key, props);
    }
  }

  return buildNamespaceGraphLayoutFromRows({
    namespace: prefix,
    edges,
    embeddings,
    labelsByKey,
    propertiesByKey,
    umapOptions,
  });
}

export function loadEdgePreview(
  persistence: Pick<MemoriesPersistence, "loadGraphEdge">,
  namespace: string,
  edgeId: string,
): EdgePreviewPayload | null {
  const link = persistence.loadGraphEdge(namespace, edgeId);
  if (!link) return null;
  return {
    edgeId: link.edgeId,
    fromKey: link.fromKey,
    toKey: link.toKey,
    labels: link.labels,
    properties: link.properties ?? null,
  };
}

export class MemoriesVisualization {
  constructor(
    private readonly db: Database,
    private readonly persistence: Pick<MemoriesPersistence, "loadGraphEdge">,
  ) {}

  loadMeanEmbeddingsForNamespace(namespace: string): GraphMemoryEmbedding[] {
    return loadMeanEmbeddingsForNamespace(this.db, namespace);
  }

  loadMemoryTextPreview(namespace: string, key: string, maxChars?: number): string | null {
    return loadMemoryTextPreview(this.db, namespace, key, maxChars);
  }

  loadSourceMapTextPreview(sourceMapId: string, maxChars?: number): string | null {
    return loadSourceMapTextPreview(this.db, sourceMapId, maxChars);
  }

  loadEdgePreview(namespace: string, edgeId: string): EdgePreviewPayload | null {
    return loadEdgePreview(this.persistence, namespace, edgeId);
  }
}

export function createMemoriesVisualization(
  db: Database,
  persistence: Pick<MemoriesPersistence, "loadGraphEdge">,
): MemoriesVisualization {
  return new MemoriesVisualization(db, persistence);
}
