import z from "zod";
import { ids } from "../models/ids";
import { MEMORY_SEARCH_META_SOURCE_KEY } from "../models/memory-search-meta";
import type { NamespacePath } from "../models/namespace-path";
import { zNamespacePath } from "../models/namespace-path";
import { zVectorPayload } from "../persistence/row-schemas";
import {
  type MemoriesPersistence,
  type MemoryOpContext,
  resolveMemoriesBackendCapabilities,
} from "../persistence/types";
import { computeSourceMapContentHash } from "../provenance/index";
import type {
  EdgeLabelInstance,
  LabelSchemaMap,
  NodeLabelInstance,
  OntologyDefinition,
} from "./ontology";
import { propsSchemaToJson } from "./ontology";

export {
  buildCanonicalMemorySearchMetaTextForMerge,
  MEMORY_SEARCH_META_SOURCE_KEY,
} from "../models/memory-search-meta";
export {
  buildCanonicalMemorySearchMetaText,
  upsertMemorySearchMetaVector,
} from "../persistence/facade";

export interface MutationCtx {
  persistence: MemoriesPersistence;
}

/** Reject reserved / system `source_key` values (prefix `__` and the search-meta key). */
export const zUserSourceKey = z
  .string()
  .refine((k) => k !== MEMORY_SEARCH_META_SOURCE_KEY && !k.startsWith("__"), {
    message: "content key is reserved (system prefix __ or search meta key)",
  });

export type MergeMemoryContentItem = z.infer<typeof zMergeMemoryContentItem>;

/** Validates {@link MergeMemoryContentItem}; exported for callers that mirror merge validation. */
export const zMergeMemoryContentItem = z
  .object({
    key: zUserSourceKey,
    text: z.string().optional(),
    vector: z.array(z.number()).optional(),
  })
  .refine((v) => v.text !== undefined || v.vector !== undefined, {
    message: "content item must include text and/or vector",
  });

/** Merge into a **node** memory (primary graph node + optional incident edges). */
export type MergeMemoryParamsNode<
  TNode extends LabelSchemaMap = LabelSchemaMap,
  TEdge extends LabelSchemaMap = LabelSchemaMap,
> = {
  kind?: "node";
  key: string;
  namespace: NamespacePath;
  content: MergeMemoryContentItem[];
  labels: NodeLabelInstance<TNode>[];
  properties?: Record<string, unknown>;
  edges?: Array<{
    peer_memory_id: string;
    direction: "in" | "out";
    label: EdgeLabelInstance<TEdge>;
    properties?: Record<string, unknown>;
  }>;
  /** Extra DAG scope attachments (primary namespace is always attached). */
  attachScopes?: NamespacePath[];
  searchMetaVector?: number[];
  ontology?: OntologyDefinition<TNode, TEdge>;
};

/** Merge into an **edge** memory (searchable unit attached to one graph edge). */
export type MergeMemoryParamsEdge<
  TNode extends LabelSchemaMap = LabelSchemaMap,
  TEdge extends LabelSchemaMap = LabelSchemaMap,
> = {
  kind: "edge";
  key: string;
  namespace: NamespacePath;
  content: MergeMemoryContentItem[];
  edge: {
    from_memory_id: string;
    to_memory_id: string;
    label: EdgeLabelInstance<TEdge>;
    properties?: Record<string, unknown>;
  };
  attachScopes?: NamespacePath[];
  searchMetaVector?: number[];
  ontology?: OntologyDefinition<TNode, TEdge>;
};

export type MergeMemoryParams<
  TNode extends LabelSchemaMap = LabelSchemaMap,
  TEdge extends LabelSchemaMap = LabelSchemaMap,
> = MergeMemoryParamsNode<TNode, TEdge> | MergeMemoryParamsEdge<TNode, TEdge>;

/**
 * Edge JSON stored on merge: keeps caller `edge.properties` and sets `directed: true` so graph
 * export can treat only merge-created directed links as directed (viz dash animation, etc.).
 */
export function withDirectedEdgeProperties(
  properties: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const base =
    properties && typeof properties === "object" && !Array.isArray(properties) ? properties : {};
  return { ...base, directed: true };
}

export function catalogSchemaJsonForNodeKind(
  ontology: OntologyDefinition | undefined,
  kind: string,
): string {
  if (!ontology) return "";
  const sch = ontology.nodeLabels[kind];
  if (!sch) throw new RangeError(`Unknown node label kind in ontology: ${kind}`);
  return JSON.stringify(propsSchemaToJson(sch));
}

export function catalogSchemaJsonForEdgeKind(
  ontology: OntologyDefinition | undefined,
  kind: string,
): string {
  if (!ontology) return "";
  const sch = ontology.edgeLabels[kind];
  if (!sch) throw new RangeError(`Unknown edge label kind in ontology: ${kind}`);
  return JSON.stringify(propsSchemaToJson(sch));
}

function validateContentAndMetaVector(
  persistence: MemoriesPersistence,
  content: MergeMemoryContentItem[],
  searchMetaVector: number[] | undefined,
): void {
  const caps = resolveMemoriesBackendCapabilities(persistence);
  for (const item of content) {
    zMergeMemoryContentItem.parse(item);
    if (item.vector !== undefined) {
      if (!caps.vectorSearch) {
        throw new Error(
          "mergeMemory: content item includes vector but persistence.capabilities.vectorSearch is false",
        );
      }
      zVectorPayload.parse(item.vector);
    }
  }
  if (searchMetaVector !== undefined && searchMetaVector.length > 0) {
    if (!caps.vectorSearch) {
      throw new Error(
        "mergeMemory: searchMetaVector set but persistence.capabilities.vectorSearch is false",
      );
    }
    zVectorPayload.parse(searchMetaVector);
  }
}

function insertContentItems(
  persistence: MemoriesPersistence,
  op: MemoryOpContext,
  memoryId: string,
  content: MergeMemoryContentItem[],
): {
  contentHashes: Record<string, string>;
  sourceKeysSorted: string[];
  textEntries: Array<{ sourceKey: string; text?: string }>;
} {
  const contentHashes: Record<string, string> = {};
  const textEntries: Array<{ sourceKey: string; text?: string }> = [];
  for (const raw of content) {
    const item = zMergeMemoryContentItem.parse(raw);
    const { sourceMapId } = persistence.insertSourceMap(op, {
      memoryId,
      sourceKey: item.key,
    });
    const vec = item.vector !== undefined ? new Float32Array(item.vector) : undefined;
    if (item.text !== undefined) {
      persistence.insertLexicalFeature(op, {
        memoryId,
        sourceMapId,
        text: item.text,
      });
    }
    if (vec !== undefined) {
      persistence.insertVectorFeature(op, {
        memoryId,
        sourceMapId,
        vector: vec,
      });
    }
    persistence.updateSourceMapContentHash(op, {
      sourceMapId,
      text: item.text,
      vector: vec,
    });
    contentHashes[item.key] = computeSourceMapContentHash({
      text: item.text,
      vector: vec,
    });
    textEntries.push({ sourceKey: item.key, text: item.text });
  }
  const sourceKeysSorted = content
    .map((raw) => zMergeMemoryContentItem.parse(raw).key)
    .sort((a, b) => a.localeCompare(b));
  return { contentHashes, sourceKeysSorted, textEntries };
}

/**
 * Orchestrates a memory merge: validates API input, then delegates storage to the persistence backend.
 * @returns Sorted memory ids whose search-meta lexical row was rebuilt (primary, neighbors, edge endpoints).
 */
export function mergeMemory(ctx: MutationCtx, params: MergeMemoryParams): string[] {
  if (params.kind === "edge") {
    return mergeMemoryEdge(ctx, params);
  }
  return mergeMemoryNode(ctx, params);
}

function mergeMemoryNode<TNode extends LabelSchemaMap, TEdge extends LabelSchemaMap>(
  ctx: MutationCtx,
  params: MergeMemoryParamsNode<TNode, TEdge>,
): string[] {
  const { persistence } = ctx;
  const now = Date.now();
  const op = { now };

  const namespace = zNamespacePath.parse(params.namespace);
  const memoryId = ids.memory(namespace, params.key);
  const nodeId = ids.node(namespace, params.key);

  validateContentAndMetaVector(persistence, params.content, params.searchMetaVector);

  let metaSyncedMemoryKeys: string[] = [];

  persistence.withTransaction(() => {
    const oldNeighbors = persistence.listNeighborMemoriesForNode(op, namespace, nodeId);
    persistence.clearMemorySubtree(op, { memoryKind: "node", memoryId, nodeId });
    persistence.upsertMemory(op, { namespace, key: params.key, kind: "node", edgeId: null });
    persistence.upsertNodeForMemoryKey(op, {
      namespace,
      memoryKey: params.key,
      memoryId,
      properties: params.properties,
    });

    const scopeIds = [...new Set([namespace, ...(params.attachScopes ?? [])])];
    persistence.replaceMemoryScopes(op, { memoryId, scopeIds });

    const { contentHashes, sourceKeysSorted, textEntries } = insertContentItems(
      persistence,
      op,
      memoryId,
      params.content,
    );

    const labelByKind = new Map<string, { kind: string; props: Record<string, unknown> }>();
    for (const l of params.labels) {
      labelByKind.set(l.kind, { kind: l.kind, props: l.props as Record<string, unknown> });
    }
    for (const l of labelByKind.values()) {
      const labelId = persistence.ensureNodeLabel(op, {
        kind: l.kind,
        description: "",
        schemaJson: catalogSchemaJsonForNodeKind(params.ontology, l.kind),
      });
      persistence.insertNodeLabelAssignment(op, { nodeId, labelId, props: l.props });
    }

    for (const edge of params.edges ?? []) {
      const peer = persistence.loadMemoryNamespaceKey(edge.peer_memory_id);
      if (peer === undefined) {
        throw new Error(`mergeMemory: unknown peer_memory_id=${edge.peer_memory_id}`);
      }
      const otherNodeId = ids.node(peer.namespace, peer.key);
      if (!persistence.nodeExists(otherNodeId)) {
        throw new Error(
          `mergeMemory: target node missing for peer_memory_id=${edge.peer_memory_id}`,
        );
      }

      const fromNodeId = edge.direction === "out" ? nodeId : otherNodeId;
      const toNodeId = edge.direction === "out" ? otherNodeId : nodeId;
      const fromMemoryId = edge.direction === "out" ? memoryId : edge.peer_memory_id;
      const toMemoryId = edge.direction === "out" ? edge.peer_memory_id : memoryId;
      const { edgeId } = persistence.insertEdge(op, {
        fromNodeId,
        toNodeId,
        properties: withDirectedEdgeProperties(edge.properties),
        idParts: {
          label: edge.label.kind,
          fromMemoryId,
          toMemoryId,
        },
      });
      const edgeLabelId = persistence.ensureEdgeLabel(op, {
        kind: edge.label.kind,
        description: "",
        schemaJson: catalogSchemaJsonForEdgeKind(params.ontology, edge.label.kind),
      });
      persistence.insertEdgeLabelAssignment(op, {
        edgeId,
        labelId: edgeLabelId,
        props: edge.label.props as Record<string, unknown>,
      });
    }

    const syncByMid = new Map<string, { namespace: NamespacePath; key: string }>();
    syncByMid.set(memoryId, { namespace, key: params.key });
    for (const n of oldNeighbors) {
      syncByMid.set(ids.memory(n.namespace, n.key), {
        namespace: n.namespace as NamespacePath,
        key: n.key,
      });
    }
    for (const e of params.edges ?? []) {
      const peer = persistence.loadMemoryNamespaceKey(e.peer_memory_id);
      if (peer !== undefined) {
        syncByMid.set(e.peer_memory_id, {
          namespace: peer.namespace as NamespacePath,
          key: peer.key,
        });
      }
    }
    const syncRefs = [...syncByMid.values()].sort((a, b) =>
      a.namespace !== b.namespace
        ? (a.namespace as string).localeCompare(b.namespace as string)
        : a.key.localeCompare(b.key),
    );
    const primaryMetaVec =
      params.searchMetaVector !== undefined && params.searchMetaVector.length > 0
        ? new Float32Array(params.searchMetaVector)
        : undefined;
    for (const ref of syncRefs) {
      const refMemoryId = ids.memory(ref.namespace, ref.key);
      persistence.syncMemorySearchMeta(op, {
        namespace: ref.namespace,
        memoryKey: ref.key,
        metaVector: refMemoryId === memoryId ? primaryMetaVec : undefined,
      });
      persistence.syncLabelPropsSearchFeatures?.(op, {
        namespace: ref.namespace,
        memoryKey: ref.key,
      });
    }
    metaSyncedMemoryKeys = [...syncByMid.keys()].sort((a, b) => a.localeCompare(b));

    const sortedHashes =
      Object.keys(contentHashes).length > 0
        ? Object.fromEntries(Object.entries(contentHashes).sort(([a], [b]) => a.localeCompare(b)))
        : undefined;
    const { root_hex } = persistence.appendProvenanceEvent(op, {
      v: 1,
      kind: "MERGE_MEMORY",
      namespace,
      memory_key: params.key,
      memory_id: memoryId,
      source_keys: sourceKeysSorted,
      ...(sortedHashes !== undefined ? { content_hashes: sortedHashes } : {}),
    });
    persistence.appendContentOutbox?.(op, {
      root_hex,
      event_type: "MERGE_MEMORY",
      namespace,
      memoryKey: params.key,
      entries: textEntries,
    });
  });

  return metaSyncedMemoryKeys;
}

function mergeMemoryEdge<TNode extends LabelSchemaMap, TEdge extends LabelSchemaMap>(
  ctx: MutationCtx,
  params: MergeMemoryParamsEdge<TNode, TEdge>,
): string[] {
  const { persistence } = ctx;
  const now = Date.now();
  const op = { now };

  const namespace = zNamespacePath.parse(params.namespace);
  const memoryId = ids.memory(namespace, params.key);

  validateContentAndMetaVector(persistence, params.content, params.searchMetaVector);

  const fromRef = persistence.loadMemoryNamespaceKey(params.edge.from_memory_id);
  const toRef = persistence.loadMemoryNamespaceKey(params.edge.to_memory_id);
  if (fromRef === undefined) {
    throw new Error(`mergeMemory: unknown edge.from_memory_id=${params.edge.from_memory_id}`);
  }
  if (toRef === undefined) {
    throw new Error(`mergeMemory: unknown edge.to_memory_id=${params.edge.to_memory_id}`);
  }
  const fromNodeId = ids.node(fromRef.namespace, fromRef.key);
  const toNodeId = ids.node(toRef.namespace, toRef.key);
  if (!persistence.nodeExists(fromNodeId)) {
    throw new Error(
      `mergeMemory: node missing for edge.from_memory_id=${params.edge.from_memory_id}`,
    );
  }
  if (!persistence.nodeExists(toNodeId)) {
    throw new Error(`mergeMemory: node missing for edge.to_memory_id=${params.edge.to_memory_id}`);
  }

  const edgeId = ids.edge(
    fromNodeId,
    toNodeId,
    params.edge.label.kind,
    params.edge.from_memory_id,
    params.edge.to_memory_id,
  );

  let metaSyncedMemoryKeys: string[] = [];

  persistence.withTransaction(() => {
    persistence.clearMemorySubtree(op, { memoryKind: "edge", memoryId, edgeId });

    const { edgeId: persistedEdgeId } = persistence.insertEdge(op, {
      fromNodeId,
      toNodeId,
      properties: withDirectedEdgeProperties(params.edge.properties),
      idParts: {
        label: params.edge.label.kind,
        fromMemoryId: params.edge.from_memory_id,
        toMemoryId: params.edge.to_memory_id,
      },
    });
    if (persistedEdgeId !== edgeId) {
      throw new Error("mergeMemory: edge id mismatch between preview and insertEdge");
    }

    persistence.upsertMemory(op, {
      namespace,
      key: params.key,
      kind: "edge",
      edgeId,
    });

    const scopeIds = [...new Set([namespace, ...(params.attachScopes ?? [])])];
    persistence.replaceMemoryScopes(op, { memoryId, scopeIds });

    const { contentHashes, sourceKeysSorted, textEntries } = insertContentItems(
      persistence,
      op,
      memoryId,
      params.content,
    );

    const edgeLabelId = persistence.ensureEdgeLabel(op, {
      kind: params.edge.label.kind,
      description: "",
      schemaJson: catalogSchemaJsonForEdgeKind(params.ontology, params.edge.label.kind),
    });
    persistence.insertEdgeLabelAssignment(op, {
      edgeId,
      labelId: edgeLabelId,
      props: params.edge.label.props as Record<string, unknown>,
    });

    const syncByMid = new Map<string, { namespace: NamespacePath; key: string }>();
    syncByMid.set(memoryId, { namespace, key: params.key });
    syncByMid.set(params.edge.from_memory_id, {
      namespace: fromRef.namespace as NamespacePath,
      key: fromRef.key,
    });
    syncByMid.set(params.edge.to_memory_id, {
      namespace: toRef.namespace as NamespacePath,
      key: toRef.key,
    });
    const primaryMetaVec =
      params.searchMetaVector !== undefined && params.searchMetaVector.length > 0
        ? new Float32Array(params.searchMetaVector)
        : undefined;
    for (const ref of syncByMid.values()) {
      const refMid = ids.memory(ref.namespace, ref.key);
      persistence.syncMemorySearchMeta(op, {
        namespace: ref.namespace,
        memoryKey: ref.key,
        metaVector: refMid === memoryId ? primaryMetaVec : undefined,
      });
      persistence.syncLabelPropsSearchFeatures?.(op, {
        namespace: ref.namespace,
        memoryKey: ref.key,
      });
    }
    metaSyncedMemoryKeys = [...syncByMid.keys()].sort((a, b) => a.localeCompare(b));

    const sortedHashes =
      Object.keys(contentHashes).length > 0
        ? Object.fromEntries(Object.entries(contentHashes).sort(([a], [b]) => a.localeCompare(b)))
        : undefined;
    const { root_hex } = persistence.appendProvenanceEvent(op, {
      v: 1,
      kind: "MERGE_MEMORY",
      namespace,
      memory_key: params.key,
      memory_id: memoryId,
      source_keys: sourceKeysSorted,
      ...(sortedHashes !== undefined ? { content_hashes: sortedHashes } : {}),
    });
    persistence.appendContentOutbox?.(op, {
      root_hex,
      event_type: "MERGE_MEMORY",
      namespace,
      memoryKey: params.key,
      entries: textEntries,
    });
  });

  return metaSyncedMemoryKeys;
}
