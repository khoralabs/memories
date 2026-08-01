import type { Database } from "bun:sqlite";
import type {
  EdgePreviewPayload,
  GraphEdgeLink,
  GraphMemoryEmbedding,
  OntologyLabelInstance,
} from "../../../persistence/core";
import {
  buildNamespaceGraphLayoutFromRows,
  collectNamespaceProjectionInput,
  type GraphLayoutEdge,
  type GraphProjectionGraphReads,
  type NamespaceGraphLayout,
  type NamespaceProjectionInput,
  qualifyMemoryKey,
  type SyncEdgePreviewReads,
  type SyncGraphProjectionGraphReads,
  type Umap3DLayoutOptions,
} from "../../../projections/index";
import { listNamespacesUnderPrefix } from "../persistence/index";
import {
  createSqliteGraphProjectionSource,
  loadMeanEmbeddingsForNamespace,
  loadMemoryTextPreview,
  loadSourceMapTextPreview,
} from "./source";

export {
  buildNamespaceGraphLayoutFromProjectionInput,
  buildNamespaceGraphLayoutFromSource,
  buildNamespaceGraphLayoutFromUmapInput,
  buildNamespaceSubtreeGraphLayoutFromSource,
  collectNamespaceProjectionInput,
  collectNamespaceUmapInput,
  createMemoriesVisualizationFromSource,
  createSeededRandom,
  DEFAULT_UMAP_LAYOUT_SEED,
  decodeProjectionInput,
  decodeUmapInput,
  encodeProjectionInput,
  encodeUmapInput,
  fibonacciSphereLayout3D,
  type GraphLayoutEdge,
  type GraphLayoutNode,
  type GraphProjectionSource,
  LABEL_PROPERTY_SYNTH_DIM,
  labelPropertySyntheticEmbedding,
  minMaxNormalize3D,
  type NamespaceGraphLayout,
  type NamespaceProjectionInput,
  type NamespaceUmapInput,
  type Point3,
  PROJECTION_INPUT_CONTENT_TYPE,
  PROJECTION_INPUT_ENCODING_HEADER,
  PROJECTION_INPUT_VERSION,
  QUALIFIED_MEMORY_KEY_SEP,
  qualifyMemoryKey,
  UMAP_INPUT_CONTENT_TYPE,
  UMAP_INPUT_ENCODING_HEADER,
  UMAP_INPUT_VERSION,
  type Umap3DLayoutOptions,
  umap3DLayout,
  validateProjectionInput,
  validateUmapInput,
} from "../../../projections/index";
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
  persistence: SyncGraphProjectionGraphReads,
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
  persistence: SyncGraphProjectionGraphReads,
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

export type CollectSqliteProjectionInputOptions = {
  namespace: string;
  scope?: "exact" | "subtree";
  provenanceHeadRootHex?: string;
};

/** @deprecated Use CollectSqliteProjectionInputOptions */
export type CollectSqliteUmapInputOptions = CollectSqliteProjectionInputOptions;

export function collectSqliteProjectionInput(
  db: Database,
  persistence: GraphProjectionGraphReads,
  input: CollectSqliteProjectionInputOptions,
): Promise<NamespaceProjectionInput> {
  const source = createSqliteGraphProjectionSource(db);
  return collectNamespaceProjectionInput(source, persistence, input.namespace, {
    provenanceHeadRootHex: input.provenanceHeadRootHex,
    scope: input.scope,
  });
}

/** @deprecated Use collectSqliteProjectionInput */
export const collectSqliteUmapInput = collectSqliteProjectionInput;

export function loadEdgePreview(
  persistence: SyncEdgePreviewReads,
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
    private readonly persistence: SyncEdgePreviewReads,
  ) {}

  loadMeanEmbeddingsForNamespace(
    namespace: string,
    opts?: { includeSuppressed?: boolean },
  ): GraphMemoryEmbedding[] {
    return loadMeanEmbeddingsForNamespace(this.db, namespace, opts);
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
  persistence: SyncEdgePreviewReads,
): MemoriesVisualization {
  return new MemoriesVisualization(db, persistence);
}
