import type { GraphEdgeLink, GraphNode, MemoriesRuntimeCtx } from "../persistence/types";

export type { GraphEdgeLink, GraphMemoryEmbedding, GraphNode } from "../persistence/types";

/**
 * Undirected edge list for a namespace: structural relatedness between memories.
 */
export function loadGraphEdgesForNamespace(
  ctx: MemoriesRuntimeCtx,
  namespace: string,
): GraphEdgeLink[] {
  return ctx.persistence.loadGraphEdgesForNamespace(namespace);
}

/** Ontology node labels per memory key in a namespace (stable order). */
export function loadNodeLabelsForNamespace(ctx: MemoriesRuntimeCtx, namespace: string) {
  return ctx.persistence.loadNodeLabelsForNamespace(namespace);
}

/** Node JSON properties per memory key (graph `nodes` row). */
export function loadNodePropertiesForNamespace(
  ctx: MemoriesRuntimeCtx,
  namespace: string,
): Map<string, Record<string, unknown> | null> {
  return ctx.persistence.loadNodePropertiesForNamespace(namespace);
}

/** Edges whose fromKey or toKey equals `memoryKey`. */
export function listIncidentGraphEdges(
  ctx: MemoriesRuntimeCtx,
  namespace: string,
  memoryKey: string,
): GraphEdgeLink[] {
  return ctx.persistence.listIncidentGraphEdges(namespace, memoryKey);
}

export function loadNodeLabelsForMemory(
  ctx: MemoriesRuntimeCtx,
  namespace: string,
  memoryKey: string,
) {
  return ctx.persistence.loadNodeLabelsForMemory(namespace, memoryKey);
}

export function loadNodePropertiesForMemory(
  ctx: MemoriesRuntimeCtx,
  namespace: string,
  memoryKey: string,
): Record<string, unknown> | null {
  return ctx.persistence.loadNodePropertiesForMemory(namespace, memoryKey);
}

export function loadGraphEdge(
  ctx: MemoriesRuntimeCtx,
  namespace: string,
  edgeId: string,
): GraphEdgeLink | null {
  return ctx.persistence.loadGraphEdge(namespace, edgeId);
}

export function loadGraphNode(
  ctx: MemoriesRuntimeCtx,
  namespace: string,
  memoryKey: string,
): GraphNode | null {
  return ctx.persistence.loadGraphNode(namespace, memoryKey);
}
