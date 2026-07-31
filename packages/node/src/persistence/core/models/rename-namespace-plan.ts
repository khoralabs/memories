import { assertNamespaceCountAllowsNew } from "./namespace-constraints";
import { assertNamespacePath, isPrefixOf, type NamespacePath } from "./namespace-path";

/** Map each source path under `from` to its renamed path under `to`. */
export function mapNamespaceUnderRename(
  namespace: string,
  from: string,
  to: string,
): NamespacePath {
  if (namespace === from) return assertNamespacePath(to);
  if (namespace.startsWith(`${from}/`)) {
    return assertNamespacePath(to + namespace.slice(from.length));
  }
  throw new Error(`namespace ${namespace} is not under rename root ${from}`);
}

/** Collect rename sources (same set as delete): always include `from`; descendants when recursive. */
export function collectRenameSourceNamespaces(
  listed: readonly string[],
  from: string,
  recursive: boolean,
): string[] {
  if (!recursive) return [from];
  const targets = new Set<string>([from]);
  for (const n of listed) {
    if (isPrefixOf(from, n)) targets.add(n);
  }
  return [...targets].sort((a, b) => a.localeCompare(b));
}

/** Build old → new path map for a rename. */
export function buildRenameNamespaceMap(
  sources: readonly string[],
  from: string,
  to: string,
): Map<string, string> {
  const nsMap = new Map<string, string>();
  for (const s of sources) {
    nsMap.set(s, mapNamespaceUnderRename(s, from, to));
  }
  return nsMap;
}

/**
 * Enforce `maxNamespaces` against the post-rename distinct set:
 * remove sources, then admit each target (net-new paths consume quota).
 */
export function assertRenameRespectsMaxNamespaces(
  existingPaths: readonly string[],
  nsMap: ReadonlyMap<string, string>,
  maxNamespaces: number | undefined,
): void {
  if (maxNamespaces === undefined) return;
  const remaining = new Set(existingPaths);
  for (const source of nsMap.keys()) remaining.delete(source);
  for (const target of nsMap.values()) {
    assertNamespaceCountAllowsNew(remaining, target, maxNamespaces);
    remaining.add(target);
  }
}
