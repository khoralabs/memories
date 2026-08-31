/**
 * Integrate-memory write-scope policy: what `exact` / `under` / `cross` mean for
 * neighbor search and namespace selection.
 */

export type IntegrateMemoryWriteScope = "exact" | "under" | "cross";

const WRITE_SCOPES = new Set<IntegrateMemoryWriteScope>(["exact", "under", "cross"]);

export function isIntegrateMemoryWriteScope(value: unknown): value is IntegrateMemoryWriteScope {
  return typeof value === "string" && WRITE_SCOPES.has(value as IntegrateMemoryWriteScope);
}

/** Parse a required writeScope value; throws on invalid input. */
export function parseIntegrateMemoryWriteScope(raw: unknown): IntegrateMemoryWriteScope {
  if (!isIntegrateMemoryWriteScope(raw)) {
    throw new Error('writeScope must be "exact", "under", or "cross"');
  }
  return raw;
}

export type WriteScopeNeighborSearchOptions = {
  namespace: string;
  searchEntireDatabase?: true;
  searchScopeMode?: "pathSubtree";
};

/** Search flags for neighbor lookup given scope + seed namespace. */
export function writeScopeNeighborSearchOptions(
  scope: IntegrateMemoryWriteScope | undefined,
  seedNamespace: string,
): WriteScopeNeighborSearchOptions {
  if (scope === "cross") {
    return { namespace: seedNamespace, searchEntireDatabase: true };
  }
  if (scope === "under") {
    return { namespace: seedNamespace, searchScopeMode: "pathSubtree" };
  }
  return { namespace: seedNamespace };
}

/** True when the workflow should ask an LLM to pick among namespace candidates. */
export function writeScopeNeedsNamespaceChoice(
  scope: IntegrateMemoryWriteScope | undefined,
): boolean {
  return scope === "under" || scope === "cross";
}

export function isUnderNamespace(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}/`);
}

/** Candidate namespaces for chooseWriteNamespace (no LLM). */
export function writeScopeNamespaceCandidates(
  scope: IntegrateMemoryWriteScope | undefined,
  seedNamespace: string,
  allNamespaces: readonly string[],
): string[] {
  if (scope === "cross") {
    return [seedNamespace, ...allNamespaces.filter((ns) => ns !== seedNamespace)].sort();
  }
  if (scope === "under") {
    return [
      seedNamespace,
      ...allNamespaces.filter((ns) => ns !== seedNamespace && ns.startsWith(`${seedNamespace}/`)),
    ];
  }
  return [seedNamespace];
}

/** Resolve LLM/raw choice against candidates + scope rules (`under` may allow one new child). */
export function resolveWriteNamespaceChoice(args: {
  scope: IntegrateMemoryWriteScope | undefined;
  seedNamespace: string;
  candidates: readonly string[];
  choice: string;
  slugifySegment: (s: string) => string;
}): string {
  const { scope, seedNamespace, candidates, slugifySegment } = args;
  const raw = args.choice.trim();
  if (candidates.includes(raw)) return raw;

  if (scope === "under") {
    const prefix = `${seedNamespace}/`;
    if (raw.startsWith(prefix)) {
      const rest = raw.slice(prefix.length);
      if (!rest.includes("/")) {
        const slug = slugifySegment(rest);
        if (slug.length > 0) {
          const next = `${seedNamespace}/${slug}`;
          if (isUnderNamespace(seedNamespace, next)) return next;
        }
      }
    }
  }

  return seedNamespace;
}
