import type { Database } from "bun:sqlite";
import type { EdgePreviewPayload } from "@khoralabs/memories-core";
import { loadGraphEdge } from "./projection";

/**
 * Same edge rows + aggregation as graph layout (`loadGraphEdgesForNamespace` → `graphEdgeLinksFromRows`),
 * so preview labels match what the graph uses for that `edgeId`.
 */
export function loadEdgePreview(
  db: Database,
  namespace: string,
  edgeId: string,
): EdgePreviewPayload | null {
  const link = loadGraphEdge(db, namespace, edgeId);
  if (!link) return null;
  return {
    edgeId: link.edgeId,
    fromKey: link.fromKey,
    toKey: link.toKey,
    labels: link.labels,
    properties: link.properties ?? null,
  };
}
