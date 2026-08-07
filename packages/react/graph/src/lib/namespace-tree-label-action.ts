/**
 * Marker for {@link GraphNamespaceTree.Label} trailing-action slotting.
 * Set on chrome button compounds and host wrappers that should sit in the actions row.
 */
export const NAMESPACE_TREE_LABEL_ACTION = "memories-namespace-tree-label-action" as const;

export type NamespaceTreeLabelActionComponent = {
  /** When true, {@link GraphNamespaceTree.Label} treats instances as trailing actions. */
  namespaceTreeLabelAction?: boolean;
};

export function marksNamespaceTreeLabelAction(type: unknown): boolean {
  return (
    typeof type === "function" &&
    (type as NamespaceTreeLabelActionComponent).namespaceTreeLabelAction === true
  );
}
