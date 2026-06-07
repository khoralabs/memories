import type { EdgePreviewPayload, MemoriesPersistence } from "@khoralabs/memories-core";

/**
 * Edge preview via {@link MemoriesPersistence.loadGraphEdge} so labels match graph layout.
 */
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
