/** Reserved `source_key` for the synthetic ontology / topology search chunk (lexical + optional vector). */
export const MEMORY_SEARCH_META_SOURCE_KEY = "__mem_search_meta__" as const;

/** Prefix for lexical chunks derived from node label ontology props (per assignment id). */
export const MEMORY_NODE_LABEL_PROPS_KEY_PREFIX = "__mem_nl_props__/" as const;

/** Prefix for lexical chunks derived from edge label ontology props (per edge **label assignment** id). */
export const MEMORY_EDGE_LABEL_PROPS_KEY_PREFIX = "__mem_edge_props__/" as const;

/** `source_key` for a node label props search chunk. */
export function memoryNodeLabelPropsSourceKey(assignmentId: string): string {
  return `${MEMORY_NODE_LABEL_PROPS_KEY_PREFIX}${assignmentId}`;
}

/** `source_key` for an edge label props search chunk on one endpoint memory. */
export function memoryEdgeLabelPropsSourceKey(edgeLabelAssignmentId: string): string {
  return `${MEMORY_EDGE_LABEL_PROPS_KEY_PREFIX}${edgeLabelAssignmentId}`;
}

/** True if this source key is system-reserved (UMAP exclusion, etc.). */
export function isSystemSearchMetaSourceKey(sourceKey: string): boolean {
  return sourceKey === MEMORY_SEARCH_META_SOURCE_KEY || sourceKey.startsWith("__");
}
