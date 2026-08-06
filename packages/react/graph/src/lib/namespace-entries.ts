/**
 * Namespace catalog row from host `GET …/namespaces` (mirrors service wire
 * `DatabaseNamespaceMetadata` without depending on memories-service).
 */
export type MemoriesGraphNamespaceEntry = {
  /** Full slash-separated path identity (not the display label). */
  namespace: string;
  /** Human-readable label for findability; prefer over renaming the path. */
  alias: string | null;
  description: string;
  /** When true, this exact path is suppressed from discovery. */
  suppressed?: boolean;
};

export type MemoriesGraphNamespacesPayload = {
  namespaces?: Array<string | MemoriesGraphNamespaceEntry>;
  profiles?: Array<{
    profileId: string;
    username?: string;
    namespace: string;
    indexed: boolean;
  }>;
  namespaceRoot?: string;
  error?: string;
};

/** Coerce host `namespaces` (legacy strings or metadata rows) into catalog entries. */
export function normalizeNamespaceEntries(
  namespaces: readonly (string | MemoriesGraphNamespaceEntry)[] | undefined,
): MemoriesGraphNamespaceEntry[] {
  if (namespaces === undefined) return [];
  const out: MemoriesGraphNamespaceEntry[] = [];
  for (const entry of namespaces) {
    if (typeof entry === "string") {
      const namespace = entry.trim();
      if (namespace.length === 0) continue;
      out.push({ namespace, alias: null, description: "" });
      continue;
    }
    if (entry === null || typeof entry !== "object") continue;
    const namespace = typeof entry.namespace === "string" ? entry.namespace.trim() : "";
    if (namespace.length === 0) continue;
    out.push({
      namespace,
      alias: typeof entry.alias === "string" ? entry.alias : null,
      description: typeof entry.description === "string" ? entry.description : "",
      ...(entry.suppressed === true ? { suppressed: true } : {}),
    });
  }
  return out;
}

export function namespacePathsFromEntries(
  entries: readonly MemoriesGraphNamespaceEntry[],
): string[] {
  return entries.map((e) => e.namespace);
}

export function namespaceEntryLabel(entry: MemoriesGraphNamespaceEntry): string {
  const alias = entry.alias?.trim();
  return alias !== undefined && alias.length > 0 ? alias : entry.namespace;
}
