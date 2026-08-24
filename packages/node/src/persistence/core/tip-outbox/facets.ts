import type { TipOutboxEventType, TipOutboxFacet, TipOutboxKeys } from "./types";

export type TipOutboxFacetConfig = {
  /** LWW grouping columns used in replay SQL (after namespace). */
  lwwKeyParts: readonly ("memory_key" | "source_key" | "edge_id")[];
  mergeEventTypes: readonly TipOutboxEventType[];
  deleteClears: boolean;
};

export const TIP_OUTBOX_FACET_CONFIG: Record<TipOutboxFacet, TipOutboxFacetConfig> = {
  content: {
    lwwKeyParts: ["memory_key", "source_key"],
    mergeEventTypes: ["MERGE_MEMORY"],
    deleteClears: true,
  },
  graph: {
    lwwKeyParts: ["memory_key", "edge_id"],
    mergeEventTypes: ["MERGE_MEMORY", "SUPPRESS_MEMORY", "UNSUPPRESS_MEMORY"],
    deleteClears: true,
  },
  vector: {
    lwwKeyParts: ["memory_key", "source_key"],
    mergeEventTypes: ["MERGE_MEMORY"],
    deleteClears: true,
  },
  provenance: {
    lwwKeyParts: [],
    mergeEventTypes: ["MERGE_MEMORY", "DELETE_MEMORY", "SUPPRESS_MEMORY", "UNSUPPRESS_MEMORY"],
    deleteClears: false,
  },
};

export function defaultFacetForEvent(eventType: TipOutboxEventType): TipOutboxFacet | undefined {
  if (eventType === "MERGE_MEMORY" || eventType === "DELETE_MEMORY") return undefined;
  return "graph";
}

export function validateKeysForFacet(facet: TipOutboxFacet, keys: TipOutboxKeys): void {
  if (facet === "provenance") return;
  if (!keys.namespace) throw new Error(`tip-outbox: facet ${facet} requires namespace`);
  if (facet === "graph") {
    if (!keys.memoryKey && !keys.edgeId) {
      throw new Error("tip-outbox: graph facet requires memoryKey or edgeId");
    }
    return;
  }
  if (!keys.memoryKey) throw new Error(`tip-outbox: facet ${facet} requires memoryKey`);
  if ((facet === "content" || facet === "vector") && !keys.sourceKey) {
    throw new Error(`tip-outbox: facet ${facet} requires sourceKey`);
  }
}
