export type NamespaceTreeNode = {
  name: string;
  path: string;
  children: NamespaceTreeNode[];
};

export type NamespaceSearchTreeHit = {
  namespace: string;
  score: number;
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

/**
 * Tree of search hit paths (ancestors included). Sibling order is best hit
 * score under that subtree (desc), then name.
 */
export function buildSearchNamespaceTree(
  results: readonly NamespaceSearchTreeHit[],
): NamespaceTreeNode[] {
  if (results.length === 0) return [];

  const hitScore = new Map<string, number>();
  for (const r of results) {
    const prev = hitScore.get(r.namespace);
    if (prev === undefined || r.score > prev) hitScore.set(r.namespace, r.score);
  }

  const root = buildNamespaceTree([...hitScore.keys()]);

  const bestScoreUnder = (node: NamespaceTreeNode): number => {
    let best = hitScore.get(node.path) ?? Number.NEGATIVE_INFINITY;
    for (const child of node.children) {
      best = Math.max(best, bestScoreUnder(child));
    }
    return best;
  };

  const sortByScore = (nodes: NamespaceTreeNode[]) => {
    nodes.sort((a, b) => {
      const sb = bestScoreUnder(b);
      const sa = bestScoreUnder(a);
      if (sb !== sa) return sb - sa;
      return a.name.localeCompare(b.name);
    });
    for (const node of nodes) sortByScore(node.children);
  };
  sortByScore(root);
  return root;
}
