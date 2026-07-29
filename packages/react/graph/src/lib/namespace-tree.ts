export type NamespaceTreeNode = {
  name: string;
  path: string;
  children: NamespaceTreeNode[];
};

/** Build a sorted path tree from flat slash-separated namespace strings. */
export function buildNamespaceTree(namespaces: readonly string[]): NamespaceTreeNode[] {
  const root: NamespaceTreeNode[] = [];

  for (const ns of namespaces) {
    const segments = ns.split("/").filter(Boolean);
    if (segments.length === 0) continue;

    let level = root;
    let path = "";
    for (const name of segments) {
      path = path ? `${path}/${name}` : name;
      let node = level.find((n) => n.name === name);
      if (!node) {
        node = { name, path, children: [] };
        level.push(node);
      }
      level = node.children;
    }
  }

  const sortRecursive = (nodes: NamespaceTreeNode[]) => {
    nodes.sort((a, b) => a.name.localeCompare(b.name));
    for (const node of nodes) sortRecursive(node.children);
  };
  sortRecursive(root);
  return root;
}

/** True when `namespace` is `path` or a descendant under `path/`. */
export function isNamespaceUnderPath(namespace: string, path: string): boolean {
  return namespace === path || namespace.startsWith(`${path}/`);
}
