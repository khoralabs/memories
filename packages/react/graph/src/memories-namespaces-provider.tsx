import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  type MemoriesGraphNamespaceEntry,
  namespacePathsFromEntries,
  normalizeNamespaceEntries,
} from "./lib/namespace-entries.js";
import {
  joinNamespacePath,
  validateNamespacePath,
  validateNamespaceSegment,
} from "./lib/namespace-path.js";
import { buildNamespaceTree, type NamespaceTreeNode } from "./lib/namespace-tree.js";
import { DEFAULT_SEARCH_DEBOUNCE_MS } from "./lib/search-debounce.js";
import type { NamespaceSearchArms, NamespaceSearchHitResult } from "./memories-client.js";
import { useMemoriesClient, useMemoriesDatabase } from "./memories-client-provider.js";

/**
 * How graph/search/catalog queries interpret the focused namespace path.
 * - `exact` — only that path
 * - `subtree` — that path and all descendants under the prefix
 */
export type GraphScope = "exact" | "subtree";

/** Optional profile ↔ namespace index row from the host catalog payload. */
export type MemoriesGraphProfileEntry = {
  profileId: string;
  username?: string;
  /** Namespace path this profile is indexed under. */
  namespace: string;
  indexed: boolean;
};

/**
 * Input for {@link MemoriesNamespacesValue.create}.
 *
 * Prefer `{ parent, name }` so hosts can validate a single segment with
 * {@link MemoriesNamespacesValue.validateSegment}, then join under a parent path.
 * Or pass a full `{ namespace }` path (already joined).
 *
 * `alias` is a human-readable label for findability; it does not change the path.
 */
export type CreateNamespaceInput =
  | {
      /** Parent path (e.g. `"global/team"`). Omit or empty for a root-level segment. */
      parent?: string;
      /** New path segment (not a full path). Validated with `validateSegment`. */
      name: string;
      /** Optional display label; prefer this over renaming for findability. */
      alias?: string | null;
      description?: string;
    }
  | {
      /** Full namespace path to create (e.g. `"global/team/notes"`). */
      namespace: string;
      /** Optional display label; prefer this over renaming for findability. */
      alias?: string | null;
      description?: string;
    };

/**
 * Namespace catalog, focus, and mutations for the graph chrome.
 *
 * Mount under {@link MemoriesClientProvider}. Downstream memory/projection providers
 * reload when `namespace` / `scope` (or the focused database) change.
 */
export type MemoriesNamespacesValue = {
  /** Focused namespace path (slash-separated identity, not the alias). */
  namespace: string;
  /** Whether catalog/search cover only `namespace` or its subtree. */
  scope: GraphScope;
  /**
   * Catalog root from host (`listNamespaces` preferred, else provider prop).
   * `null` until a non-empty root is supplied — React does not invent one.
   */
  namespaceRoot: string | null;
  /**
   * Set focus to `path`. When `scope` is omitted, uses `subtree` at `namespaceRoot`
   * and `exact` elsewhere (or `exact` when root is still unknown).
   * @param path - Full namespace path to focus
   * @param scope - Optional override for exact vs subtree
   */
  focus: (path: string, scope?: GraphScope) => void;
  /** Change exact vs subtree without changing the focused path. */
  setScope: (scope: GraphScope) => void;

  /** Catalog rows (path + alias + description + optional `suppressed`). */
  entries: MemoriesGraphNamespaceEntry[];
  /** Paths derived from `entries`. */
  paths: string[];
  /** Optional profile index rows from the catalog payload. */
  profiles: MemoriesGraphProfileEntry[];
  /** Tree built from `paths` for pickers. */
  tree: NamespaceTreeNode[];
  /** Lookup a catalog row by full path. */
  getEntry: (path: string) => MemoriesGraphNamespaceEntry | undefined;
  loading: boolean;
  error: string | null;
  /** Refetch the namespace catalog from the client. */
  reload: () => Promise<void>;

  /**
   * Create (upsert) a namespace path, reload the catalog, and focus the new path.
   * @see CreateNamespaceInput
   */
  create: (input: CreateNamespaceInput) => Promise<MemoriesGraphNamespaceEntry>;
  /**
   * Physically rematerialize memories from one path onto another.
   *
   * **Prefer {@link updateMetadata} with `alias` for findability.** Renaming is
   * destructive and expensive: it remaps deterministic ids under the new path(s),
   * can fail on key collisions at the destination, and scales with memory count
   * (and descendants when recursive). Use rename only when the path identity itself
   * must change (e.g. structural reorganization), not for display naming.
   *
   * @param input.from - Existing full path (e.g. `"global/old-name"`)
   * @param input.to - Destination full path (e.g. `"global/new-name"`)
   * @param input.recursive - When true (default), also remaps `from/…` → `to/…`
   * @returns Each remapped path pair plus how many memories moved
   */
  rename: (input: {
    from: string;
    to: string;
    recursive?: boolean;
  }) => Promise<{ namespaces: Array<{ from: string; to: string }>; renamedMemories: number }>;
  /**
   * Update alias and/or description for an existing path without moving memories.
   * Prefer setting `alias` over {@link rename} when hosts only need a friendlier label.
   *
   * @param input.namespace - Full path of the row to update (identity; not renamed)
   * @param input.alias - Display label (`null` clears). Does not change the path.
   * @param input.description - Optional description text
   */
  updateMetadata: (input: {
    namespace: string;
    alias?: string | null;
    description?: string;
  }) => Promise<MemoriesGraphNamespaceEntry>;
  /**
   * Delete a namespace path (and optionally descendants) and its memories.
   * If focus was on or under `namespace`, focus returns to `namespaceRoot` when known;
   * otherwise focus is cleared.
   *
   * @param input.namespace - Full path to delete
   * @param input.recursive - When true, delete descendants as well (service semantics)
   */
  remove: (input: {
    namespace: string;
    recursive?: boolean;
  }) => Promise<{ namespaces: string[]; deletedMemories: number }>;
  /**
   * Mark a path suppressed so it (and descendants) are hidden from discovery.
   * Writes may still target the path. Idempotent if already suppressed.
   * @param input.namespace - Full path to suppress
   */
  suppress: (input: { namespace: string }) => Promise<void>;
  /**
   * Clear exact-path suppression for `namespace` (does not clear child flags).
   * @param input.namespace - Full path to unsuppress
   */
  unsuppress: (input: { namespace: string }) => Promise<void>;

  /**
   * Debounced namespace search query. Empty clears {@link searchResults}.
   * Behavior is driven by {@link searchArms} (nodes / lexical / vector).
   */
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  /**
   * Arm weights for namespace search (default `{ nodes: 1, lexical: 1 }`).
   * - `nodes > 0` — unscoped memory search then rank by hits
   * - `lexical > 0` with nodes — metadata alias/description boost
   * - `nodes = 0`, `lexical > 0` — catalog metadata ranking only
   */
  searchArms: NamespaceSearchArms;
  setSearchArms: (arms: NamespaceSearchArms) => void;
  /** When set, only namespaces under this path (inclusive). `null` = whole DB. */
  searchUnder: string | null;
  setSearchUnder: (path: string | null) => void;
  /** Last successful ranked namespace hits, or `null` when idle/empty query. */
  searchResults: NamespaceSearchHitResult[] | null;
  searchLoading: boolean;
  searchError: string | null;

  /** Validate a single path segment; returns an error message or `null`. */
  validateSegment: typeof validateNamespaceSegment;
  /** Validate a full path (segments + max depth); returns an error message or `null`. */
  validatePath: typeof validateNamespacePath;
  /** Join `parent` + `segment` into a full path. */
  joinPath: typeof joinNamespacePath;
};

const MemoriesNamespacesContext = createContext<MemoriesNamespacesValue | null>(null);

const DEFAULT_SEARCH_ARMS: NamespaceSearchArms = { nodes: 1, lexical: 1 };

export type MemoriesNamespacesProviderProps = PropsWithChildren<{
  /**
   * Initial (and controlled) focused path.
   * When omitted or blank, focuses {@link namespaceRoot} once a root is known.
   */
  namespace?: string;
  /**
   * Initial (and controlled) exact vs subtree scope.
   * When omitted, uses `subtree` at {@link namespaceRoot} and `exact` elsewhere.
   */
  scope?: GraphScope;
  /**
   * Catalog root seed (host-owned). Prefer stamping root on `listNamespaces`
   * (e.g. `createServiceReactMemoriesClient({ namespaceRoot })`); catalog wins when present.
   * No package default — omit until catalog/prop supplies a path.
   */
  namespaceRoot?: string;
  /**
   * Debounce for namespace search queries in ms.
   * @default DEFAULT_SEARCH_DEBOUNCE_MS
   */
  searchDebounceMs?: number;
  /**
   * When true, catalog list and namespace search include suppressed paths.
   * @default false
   */
  includeSuppressed?: boolean;
  /**
   * Host write limits for namespace paths (e.g. from `/databases/capabilities` `namespaceLimits`).
   * Defaults match memories-node (depth 6, length 512).
   */
  namespaceLimits?: { maxDepth?: number; maxLength?: number };
}>;

function resolveNamespaceRootProp(prop: string | undefined): string | null {
  const trimmed = prop?.trim();
  return trimmed ? trimmed : null;
}

function resolveFocusedNamespace(
  namespace: string | undefined,
  namespaceRoot: string | null,
): string {
  const trimmed = namespace?.trim();
  if (trimmed) return trimmed;
  return namespaceRoot ?? "";
}

function resolveCreatePath(
  input: CreateNamespaceInput,
  policy?: { maxDepth?: number; maxLength?: number },
): string {
  if ("namespace" in input) {
    return input.namespace.trim();
  }
  const segmentError = validateNamespaceSegment(input.name);
  if (segmentError) throw new Error(segmentError);
  const path = joinNamespacePath(input.parent, input.name.trim());
  const pathError = validateNamespacePath(path, policy);
  if (pathError) throw new Error(pathError);
  return path;
}

function defaultFocusScope(path: string, namespaceRoot: string | null): GraphScope {
  return namespaceRoot !== null && path === namespaceRoot ? "subtree" : "exact";
}

function rewriteFocusedPath(current: string, from: string, to: string): string | null {
  if (current === from) return to;
  if (current.startsWith(`${from}/`)) return `${to}${current.slice(from.length)}`;
  return null;
}

function isUnderOrEqual(path: string, ancestor: string): boolean {
  return path === ancestor || path.startsWith(`${ancestor}/`);
}

/**
 * Owns namespace catalog, focus (`namespace` / `scope`), and mutations.
 * Requires {@link MemoriesClientProvider} above. Prefer {@link MemoriesNamespacesValue.updateMetadata}
 * (`alias`) for findability; {@link MemoriesNamespacesValue.rename} is a costly path rematerialization.
 */
export function MemoriesNamespacesProvider({
  children,
  namespace: namespaceProp,
  scope: scopeProp,
  namespaceRoot: namespaceRootProp,
  searchDebounceMs = DEFAULT_SEARCH_DEBOUNCE_MS,
  includeSuppressed = false,
  namespaceLimits,
}: MemoriesNamespacesProviderProps) {
  const client = useMemoriesClient();
  const { database } = useMemoriesDatabase();
  const databaseKey = `${database.kind}:${database.ownerKey}`;
  const [namespaceRoot, setNamespaceRoot] = useState<string | null>(() =>
    resolveNamespaceRootProp(namespaceRootProp),
  );
  const [namespace, setNamespace] = useState(() =>
    resolveFocusedNamespace(namespaceProp, resolveNamespaceRootProp(namespaceRootProp)),
  );
  const [scope, setScopeState] = useState<GraphScope>(() => {
    const root = resolveNamespaceRootProp(namespaceRootProp);
    const focused = resolveFocusedNamespace(namespaceProp, root);
    return scopeProp ?? defaultFocusScope(focused, root);
  });
  const [entries, setEntries] = useState<MemoriesGraphNamespaceEntry[]>([]);
  const [profiles, setProfiles] = useState<MemoriesGraphProfileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchArms, setSearchArms] = useState<NamespaceSearchArms>(DEFAULT_SEARCH_ARMS);
  const [searchUnder, setSearchUnder] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<NamespaceSearchHitResult[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  useEffect(() => {
    const fromProp = resolveNamespaceRootProp(namespaceRootProp);
    if (fromProp !== null) setNamespaceRoot(fromProp);
  }, [namespaceRootProp]);

  useEffect(() => {
    const root = resolveNamespaceRootProp(namespaceRootProp);
    setNamespace(resolveFocusedNamespace(namespaceProp, root));
  }, [namespaceProp, namespaceRootProp]);

  useEffect(() => {
    if (scopeProp !== undefined) {
      setScopeState(scopeProp);
      return;
    }
    const root = resolveNamespaceRootProp(namespaceRootProp);
    const focused = resolveFocusedNamespace(namespaceProp, root);
    setScopeState(defaultFocusScope(focused, root));
  }, [scopeProp, namespaceProp, namespaceRootProp]);

  // When catalog/prop later supplies a root and focus is still empty, land on root.
  useEffect(() => {
    if (namespaceRoot === null) return;
    if (namespaceProp?.trim()) return;
    setNamespace((current) => {
      if (current.trim().length > 0) return current;
      if (scopeProp === undefined) setScopeState("subtree");
      return namespaceRoot;
    });
  }, [namespaceRoot, namespaceProp, scopeProp]);

  // Reset focus + search when the focused database changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional reset on DB switch
  useEffect(() => {
    const root = resolveNamespaceRootProp(namespaceRootProp);
    const focused = resolveFocusedNamespace(namespaceProp, root);
    setNamespaceRoot(root);
    setNamespace(focused);
    setScopeState(scopeProp ?? defaultFocusScope(focused, root));
    setSearchQuery("");
    setSearchResults(null);
    setSearchError(null);
    setSearchLoading(false);
    setSearchUnder(null);
    setSearchArms(DEFAULT_SEARCH_ARMS);
  }, [databaseKey]);

  const paths = useMemo(() => namespacePathsFromEntries(entries), [entries]);
  const tree = useMemo(() => buildNamespaceTree(paths), [paths]);
  const entriesByPath = useMemo(() => {
    const map = new Map<string, MemoriesGraphNamespaceEntry>();
    for (const entry of entries) map.set(entry.namespace, entry);
    return map;
  }, [entries]);

  const getEntry = useCallback((path: string) => entriesByPath.get(path), [entriesByPath]);

  const focus = useCallback(
    (path: string, nextScope?: GraphScope) => {
      const trimmed = path.trim();
      if (trimmed.length === 0) return;
      setNamespace(trimmed);
      setScopeState(nextScope ?? defaultFocusScope(trimmed, namespaceRoot));
    },
    [namespaceRoot],
  );

  const setScope = useCallback((next: GraphScope) => {
    setScopeState(next);
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const json = await client.listNamespaces(
        includeSuppressed ? { includeSuppressed: true } : undefined,
      );
      setEntries(normalizeNamespaceEntries(json.namespaces));
      setProfiles(json.profiles ?? []);
      const fromCatalog = json.namespaceRoot?.trim();
      if (fromCatalog) setNamespaceRoot(fromCatalog);
    } catch (e) {
      setEntries([]);
      setProfiles([]);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [client, includeSuppressed]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults(null);
      setSearchLoading(false);
      setSearchError(null);
      return;
    }
    const ac = new AbortController();
    const id = window.setTimeout(() => {
      void (async () => {
        setSearchLoading(true);
        setSearchError(null);
        try {
          const result = await client.searchNamespaces({
            query: q,
            namespace,
            signal: ac.signal,
            ...(searchUnder !== null ? { under: searchUnder } : {}),
            arms: searchArms,
            ...(includeSuppressed ? { includeSuppressed: true } : {}),
          });
          if (ac.signal.aborted) return;
          setSearchResults(result.namespaces);
        } catch (e) {
          if (ac.signal.aborted) return;
          setSearchResults(null);
          setSearchError(e instanceof Error ? e.message : String(e));
        } finally {
          if (!ac.signal.aborted) setSearchLoading(false);
        }
      })();
    }, searchDebounceMs);
    return () => {
      window.clearTimeout(id);
      ac.abort();
    };
  }, [
    client,
    searchQuery,
    searchArms,
    searchUnder,
    namespace,
    searchDebounceMs,
    includeSuppressed,
  ]);

  const create = useCallback(
    async (input: CreateNamespaceInput) => {
      const path = resolveCreatePath(input, namespaceLimits);
      const pathError = validateNamespacePath(path, namespaceLimits);
      if (pathError) throw new Error(pathError);
      const entry = await client.upsertNamespace({
        namespace: path,
        ...("alias" in input && input.alias !== undefined ? { alias: input.alias } : {}),
        ...("description" in input && input.description !== undefined
          ? { description: input.description }
          : {}),
      });
      await reload();
      focus(path);
      return entry;
    },
    [client, focus, reload, namespaceLimits],
  );

  const rename = useCallback(
    async (input: { from: string; to: string; recursive?: boolean }) => {
      const result = await client.renameNamespace({
        from: input.from,
        to: input.to,
        ...(input.recursive !== undefined ? { recursive: input.recursive } : {}),
      });
      await reload();
      setNamespace((current) => {
        const next = rewriteFocusedPath(current, input.from, input.to);
        return next ?? current;
      });
      return result;
    },
    [client, reload],
  );

  const updateMetadata = useCallback(
    async (input: { namespace: string; alias?: string | null; description?: string }) => {
      const entry = await client.upsertNamespace({
        namespace: input.namespace,
        ...(input.alias !== undefined ? { alias: input.alias } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
      });
      await reload();
      return entry;
    },
    [client, reload],
  );

  const remove = useCallback(
    async (input: { namespace: string; recursive?: boolean }) => {
      const result = await client.deleteNamespace({
        namespace: input.namespace,
        ...(input.recursive !== undefined ? { recursive: input.recursive } : {}),
      });
      await reload();
      setNamespace((current) => {
        if (!isUnderOrEqual(current, input.namespace)) return current;
        if (namespaceRoot !== null) {
          setScopeState(defaultFocusScope(namespaceRoot, namespaceRoot));
          return namespaceRoot;
        }
        return "";
      });
      return result;
    },
    [client, namespaceRoot, reload],
  );

  const suppress = useCallback(
    async (input: { namespace: string }) => {
      const path = input.namespace.trim();
      if (!path) throw new Error("suppress requires a non-empty namespace");
      await client.suppressNamespace({ namespace: path });
      await reload();
    },
    [client, reload],
  );

  const unsuppress = useCallback(
    async (input: { namespace: string }) => {
      const path = input.namespace.trim();
      if (!path) throw new Error("unsuppress requires a non-empty namespace");
      await client.unsuppressNamespace({ namespace: path });
      await reload();
    },
    [client, reload],
  );

  const value = useMemo(
    (): MemoriesNamespacesValue => ({
      namespace,
      scope,
      namespaceRoot,
      focus,
      setScope,
      entries,
      paths,
      profiles,
      tree,
      getEntry,
      loading,
      error,
      reload,
      create,
      rename,
      updateMetadata,
      remove,
      suppress,
      unsuppress,
      searchQuery,
      setSearchQuery,
      searchArms,
      setSearchArms,
      searchUnder,
      setSearchUnder,
      searchResults,
      searchLoading,
      searchError,
      validateSegment: validateNamespaceSegment,
      validatePath: (path: string) => validateNamespacePath(path, namespaceLimits),
      joinPath: joinNamespacePath,
    }),
    [
      namespace,
      scope,
      namespaceRoot,
      focus,
      setScope,
      entries,
      paths,
      profiles,
      tree,
      getEntry,
      loading,
      error,
      reload,
      create,
      rename,
      updateMetadata,
      remove,
      suppress,
      unsuppress,
      searchQuery,
      searchArms,
      searchUnder,
      searchResults,
      searchLoading,
      searchError,
      namespaceLimits,
    ],
  );

  return (
    <MemoriesNamespacesContext.Provider value={value}>
      {children}
    </MemoriesNamespacesContext.Provider>
  );
}

/** Access {@link MemoriesNamespacesValue}; must be under {@link MemoriesNamespacesProvider}. */
export function useMemoriesNamespaces(): MemoriesNamespacesValue {
  const ctx = useContext(MemoriesNamespacesContext);
  if (ctx == null) {
    throw new Error("useMemoriesNamespaces must be used within MemoriesNamespacesProvider");
  }
  return ctx;
}
