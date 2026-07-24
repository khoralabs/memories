import type { NamespacePath } from "../../persistence/core";
import { ids, zNamespacePath } from "../../persistence/core";
import type { MemoriesPersistenceAsync, MemoryOpContext } from "../../persistence/core/persistence";
import {
  resolveMemoriesBackendCapabilities,
  zVectorPayload,
} from "../../persistence/core/persistence";
import { computeSourceMapContentHash } from "../../persistence/core/provenance";
import { type MemoriesTelemetry, runWithOpTelemetryAsync } from "../../telemetry/index.js";
import {
  buildMemoryOpContext,
  catalogSchemaJsonForEdgeKind,
  catalogSchemaJsonForNodeKind,
  type MergeMemoryParams,
  type MergeMemoryParamsEdge,
  type MergeMemoryParamsNode,
  withDirectedEdgeProperties,
  zMergeMemoryContentItem,
} from "./merge-memory";

export interface MutationCtxAsync {
  persistence: MemoriesPersistenceAsync;
  /** Optional structured ops telemetry sink. */
  telemetry?: MemoriesTelemetry;
}

/**
 * Same contract as {@link mergeMemory} for {@link MemoriesPersistenceAsync} (awaiting each store call).
 */
export async function mergeMemoryAsync(
  ctx: MutationCtxAsync,
  params: MergeMemoryParams,
): Promise<string[]> {
  const memoryKind = params.kind === "edge" ? "edge" : "node";
  return runWithOpTelemetryAsync({
    telemetry: ctx.telemetry,
    op: "merge",
    namespace: params.namespace,
    memoryKind,
    memoryKey: params.key,
    getProvenanceRootHex: async () => (await ctx.persistence.getProvenanceHeadRootHex()) ?? "",
    successFields: (ids) => ({ mergedMemoryCount: ids.length }),
    fn: async () => {
      const { persistence } = ctx;
      const caps = resolveMemoriesBackendCapabilities(persistence);
      const op = buildMemoryOpContext(params.attribution);

      const namespace = zNamespacePath.parse(params.namespace);

      for (const item of params.content) {
        zMergeMemoryContentItem.parse(item);
        if (item.vector !== undefined) {
          if (!caps.vectorSearch) {
            throw new Error(
              "mergeMemoryAsync: content item includes vector but persistence.capabilities.vectorSearch is false",
            );
          }
          zVectorPayload.parse(item.vector);
        }
      }

      if (params.searchMetaVector !== undefined && params.searchMetaVector.length > 0) {
        if (!caps.vectorSearch) {
          throw new Error(
            "mergeMemoryAsync: searchMetaVector set but persistence.capabilities.vectorSearch is false",
          );
        }
        zVectorPayload.parse(params.searchMetaVector);
      }

      if (params.kind === "edge") {
        return mergeMemoryAsyncEdge(ctx, params, namespace, op);
      }
      return mergeMemoryAsyncNode(ctx, params, namespace, op);
    },
  });
}

async function mergeMemoryAsyncNode(
  ctx: MutationCtxAsync,
  params: MergeMemoryParamsNode,
  namespace: ReturnType<typeof zNamespacePath.parse>,
  op: MemoryOpContext,
): Promise<string[]> {
  const { persistence } = ctx;
  const memoryId = ids.memory(namespace, params.key);
  const nodeId = ids.node(namespace, params.key);

  let metaSyncedMemoryKeys: string[] = [];

  await persistence.withTransaction(async () => {
    const oldNeighbors = await persistence.listNeighborMemoriesForNode(op, namespace, nodeId);
    await persistence.clearMemorySubtree(op, { memoryKind: "node", memoryId, nodeId });
    await persistence.upsertMemory(op, { namespace, key: params.key, kind: "node", edgeId: null });
    await persistence.upsertNodeForMemoryKey(op, {
      namespace,
      memoryKey: params.key,
      memoryId,
      properties: params.properties,
    });

    const scopeIds = [...new Set([namespace, ...(params.attachScopes ?? [])])];
    await persistence.replaceMemoryScopes(op, { memoryId, scopeIds });

    const contentHashes: Record<string, string> = {};
    const textEntries: Array<{ sourceKey: string; text?: string }> = [];
    for (const raw of params.content) {
      const item = zMergeMemoryContentItem.parse(raw);
      const { sourceMapId } = await persistence.insertSourceMap(op, {
        memoryId,
        sourceKey: item.key,
      });
      const vec = item.vector !== undefined ? new Float32Array(item.vector) : undefined;
      if (item.text !== undefined) {
        await persistence.insertLexicalFeature(op, {
          memoryId,
          sourceMapId,
          text: item.text,
        });
      }
      if (vec !== undefined) {
        await persistence.insertVectorFeature(op, {
          memoryId,
          sourceMapId,
          vector: vec,
        });
      }
      await persistence.updateSourceMapContentHash(op, {
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

    const labelByKind = new Map(params.labels.map((l) => [l.kind, l] as const));
    for (const l of labelByKind.values()) {
      const labelId = await persistence.ensureNodeLabel(op, {
        kind: l.kind,
        description: "",
        schemaJson: catalogSchemaJsonForNodeKind(params.ontology, l.kind),
      });
      await persistence.insertNodeLabelAssignment(op, {
        nodeId,
        labelId,
        props: l.props as Record<string, unknown>,
      });
    }

    for (const edge of params.edges ?? []) {
      const peer = await persistence.loadMemoryNamespaceKey(edge.peer_memory_id);
      if (peer === undefined) {
        throw new Error(`mergeMemoryAsync: unknown peer_memory_id=${edge.peer_memory_id}`);
      }
      const otherNodeId = ids.node(peer.namespace, peer.key);
      if (!(await persistence.nodeExists(otherNodeId))) {
        throw new Error(
          `mergeMemoryAsync: target node missing for peer_memory_id=${edge.peer_memory_id}`,
        );
      }

      const fromNodeId = edge.direction === "out" ? nodeId : otherNodeId;
      const toNodeId = edge.direction === "out" ? otherNodeId : nodeId;
      const fromMemoryId = edge.direction === "out" ? memoryId : edge.peer_memory_id;
      const toMemoryId = edge.direction === "out" ? edge.peer_memory_id : memoryId;
      const { edgeId } = await persistence.insertEdge(op, {
        fromNodeId,
        toNodeId,
        properties: withDirectedEdgeProperties(edge.properties),
        idParts: {
          label: edge.label.kind,
          fromMemoryId,
          toMemoryId,
        },
      });
      const edgeLabelId = await persistence.ensureEdgeLabel(op, {
        kind: edge.label.kind,
        description: "",
        schemaJson: catalogSchemaJsonForEdgeKind(params.ontology, edge.label.kind),
      });
      await persistence.insertEdgeLabelAssignment(op, {
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
      const peer = await persistence.loadMemoryNamespaceKey(e.peer_memory_id);
      if (peer !== undefined) {
        syncByMid.set(e.peer_memory_id, {
          namespace: peer.namespace as NamespacePath,
          key: peer.key,
        });
      }
    }

    const primaryMetaVec =
      params.searchMetaVector !== undefined && params.searchMetaVector.length > 0
        ? new Float32Array(params.searchMetaVector)
        : undefined;
    for (const ref of syncByMid.values()) {
      const refMemoryId = ids.memory(ref.namespace, ref.key);
      await persistence.syncMemorySearchMeta(op, {
        namespace: ref.namespace,
        memoryKey: ref.key,
        metaVector: refMemoryId === memoryId ? primaryMetaVec : undefined,
      });
      const syncLabelProps = persistence.syncLabelPropsSearchFeatures;
      if (syncLabelProps !== undefined) {
        await syncLabelProps(op, {
          namespace: ref.namespace,
          memoryKey: ref.key,
        });
      }
    }
    metaSyncedMemoryKeys = [...syncByMid.keys()].sort((a, b) => a.localeCompare(b));

    const sourceKeysSorted = params.content
      .map((raw) => zMergeMemoryContentItem.parse(raw).key)
      .sort((a, b) => a.localeCompare(b));
    const sortedHashes =
      Object.keys(contentHashes).length > 0
        ? Object.fromEntries(Object.entries(contentHashes).sort(([a], [b]) => a.localeCompare(b)))
        : undefined;
    const { root_hex } = await persistence.appendProvenanceEvent(op, {
      v: 1,
      kind: "MERGE_MEMORY",
      namespace,
      memory_key: params.key,
      memory_id: memoryId,
      source_keys: sourceKeysSorted,
      ...(sortedHashes !== undefined ? { content_hashes: sortedHashes } : {}),
      ...(op.contributor !== undefined ? { contributor: op.contributor } : {}),
      ...(op.intentSnapshotId !== undefined ? { intent_snapshot_id: op.intentSnapshotId } : {}),
    });
    await persistence.appendContentOutbox?.(op, {
      root_hex,
      event_type: "MERGE_MEMORY",
      namespace,
      memoryKey: params.key,
      entries: textEntries,
    });
  });

  return metaSyncedMemoryKeys;
}

async function mergeMemoryAsyncEdge(
  ctx: MutationCtxAsync,
  params: MergeMemoryParamsEdge,
  namespace: ReturnType<typeof zNamespacePath.parse>,
  op: MemoryOpContext,
): Promise<string[]> {
  const { persistence } = ctx;
  const memoryId = ids.memory(namespace, params.key);

  const fromRef = await persistence.loadMemoryNamespaceKey(params.edge.from_memory_id);
  const toRef = await persistence.loadMemoryNamespaceKey(params.edge.to_memory_id);
  if (fromRef === undefined) {
    throw new Error(`mergeMemoryAsync: unknown edge.from_memory_id=${params.edge.from_memory_id}`);
  }
  if (toRef === undefined) {
    throw new Error(`mergeMemoryAsync: unknown edge.to_memory_id=${params.edge.to_memory_id}`);
  }
  const fromNodeId = ids.node(fromRef.namespace, fromRef.key);
  const toNodeId = ids.node(toRef.namespace, toRef.key);
  if (!(await persistence.nodeExists(fromNodeId))) {
    throw new Error(
      `mergeMemoryAsync: node missing for edge.from_memory_id=${params.edge.from_memory_id}`,
    );
  }
  if (!(await persistence.nodeExists(toNodeId))) {
    throw new Error(
      `mergeMemoryAsync: node missing for edge.to_memory_id=${params.edge.to_memory_id}`,
    );
  }

  const edgeId = ids.edge(
    fromNodeId,
    toNodeId,
    params.edge.label.kind,
    params.edge.from_memory_id,
    params.edge.to_memory_id,
  );

  let metaSyncedMemoryKeys: string[] = [];

  await persistence.withTransaction(async () => {
    await persistence.clearMemorySubtree(op, { memoryKind: "edge", memoryId, edgeId });

    const { edgeId: persistedEdgeId } = await persistence.insertEdge(op, {
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
      throw new Error("mergeMemoryAsync: edge id mismatch between preview and insertEdge");
    }

    await persistence.upsertMemory(op, {
      namespace,
      key: params.key,
      kind: "edge",
      edgeId,
    });

    const scopeIds = [...new Set([namespace, ...(params.attachScopes ?? [])])];
    await persistence.replaceMemoryScopes(op, { memoryId, scopeIds });

    const contentHashes: Record<string, string> = {};
    const textEntries: Array<{ sourceKey: string; text?: string }> = [];
    for (const raw of params.content) {
      const item = zMergeMemoryContentItem.parse(raw);
      const { sourceMapId } = await persistence.insertSourceMap(op, {
        memoryId,
        sourceKey: item.key,
      });
      const vec = item.vector !== undefined ? new Float32Array(item.vector) : undefined;
      if (item.text !== undefined) {
        await persistence.insertLexicalFeature(op, {
          memoryId,
          sourceMapId,
          text: item.text,
        });
      }
      if (vec !== undefined) {
        await persistence.insertVectorFeature(op, {
          memoryId,
          sourceMapId,
          vector: vec,
        });
      }
      await persistence.updateSourceMapContentHash(op, {
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

    const edgeLabelId = await persistence.ensureEdgeLabel(op, {
      kind: params.edge.label.kind,
      description: "",
      schemaJson: catalogSchemaJsonForEdgeKind(params.ontology, params.edge.label.kind),
    });
    await persistence.insertEdgeLabelAssignment(op, {
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
      await persistence.syncMemorySearchMeta(op, {
        namespace: ref.namespace,
        memoryKey: ref.key,
        metaVector: refMid === memoryId ? primaryMetaVec : undefined,
      });
      const syncLabelProps = persistence.syncLabelPropsSearchFeatures;
      if (syncLabelProps !== undefined) {
        await syncLabelProps(op, {
          namespace: ref.namespace,
          memoryKey: ref.key,
        });
      }
    }
    metaSyncedMemoryKeys = [...syncByMid.keys()].sort((a, b) => a.localeCompare(b));

    const sourceKeysSorted = params.content
      .map((raw) => zMergeMemoryContentItem.parse(raw).key)
      .sort((a, b) => a.localeCompare(b));
    const sortedHashes =
      Object.keys(contentHashes).length > 0
        ? Object.fromEntries(Object.entries(contentHashes).sort(([a], [b]) => a.localeCompare(b)))
        : undefined;
    const { root_hex } = await persistence.appendProvenanceEvent(op, {
      v: 1,
      kind: "MERGE_MEMORY",
      namespace,
      memory_key: params.key,
      memory_id: memoryId,
      source_keys: sourceKeysSorted,
      ...(sortedHashes !== undefined ? { content_hashes: sortedHashes } : {}),
      ...(op.contributor !== undefined ? { contributor: op.contributor } : {}),
      ...(op.intentSnapshotId !== undefined ? { intent_snapshot_id: op.intentSnapshotId } : {}),
    });
    await persistence.appendContentOutbox?.(op, {
      root_hex,
      event_type: "MERGE_MEMORY",
      namespace,
      memoryKey: params.key,
      entries: textEntries,
    });
  });

  return metaSyncedMemoryKeys;
}

export type { MergeMemoryContentItem, MergeMemoryParams } from "./merge-memory";
export { zMergeMemoryContentItem, zUserSourceKey } from "./merge-memory";
