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
import { useMemoriesClient, useMemoriesDatabase } from "./memories-client-provider.js";

export type GraphScope = "exact" | "subtree";

export const DEFAULT_MEMORIES_NAMESPACE = "_global_";
export const DEFAULT_NAMESPACE_ROOT = "global";

export type MemoriesGraphProfileEntry = {
  profileId: string;
  username?: string;
  namespace: string;
  indexed: boolean;
};

export type CreateNamespaceInput =
  | {
      parent?: string;
      name: string;
      alias?: string | null;
      description?: string;
    }
  | {
      namespace: string;
      alias?: string | null;
      description?: string;
    };

export type MemoriesNamespacesValue = {
  namespace: string;
  scope: GraphScope;
  namespaceRoot: string;
  focus: (path: string, scope?: GraphScope) => void;
  setScope: (scope: GraphScope) => void;

  entries: MemoriesGraphNamespaceEntry[];
  paths: string[];
  profiles: MemoriesGraphProfileEntry[];
  tree: NamespaceTreeNode[];
  getEntry: (path: string) => MemoriesGraphNamespaceEntry | undefined;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;

  create: (input: CreateNamespaceInput) => Promise<MemoriesGraphNamespaceEntry>;
  rename: (input: {
    from: string;
    to: string;
    recursive?: boolean;
  }) => Promise<{ namespaces: Array<{ from: string; to: string }>; renamedMemories: number }>;
  updateMetadata: (input: {
    namespace: string;
    alias?: string | null;
    description?: string;
  }) => Promise<MemoriesGraphNamespaceEntry>;
  remove: (input: {
    namespace: string;
    recursive?: boolean;
  }) => Promise<{ namespaces: string[]; deletedMemories: number }>;
  suppress: (input: { namespace: string }) => Promise<void>;
  unsuppress: (input: { namespace: string }) => Promise<void>;

  validateSegment: typeof validateNamespaceSegment;
  validatePath: typeof validateNamespacePath;
  joinPath: typeof joinNamespacePath;
};

const MemoriesNamespacesContext = createContext<MemoriesNamespacesValue | null>(null);

export type MemoriesNamespacesProviderProps = PropsWithChildren<{
  namespace?: string;
  scope?: GraphScope;
  namespaceRoot?: string;
}>;

function resolveCreatePath(input: CreateNamespaceInput): string {
  if ("namespace" in input) {
    return input.namespace.trim();
  }
  const segmentError = validateNamespaceSegment(input.name);
  if (segmentError) throw new Error(segmentError);
  const path = joinNamespacePath(input.parent, input.name.trim());
  const pathError = validateNamespacePath(path);
  if (pathError) throw new Error(pathError);
  return path;
}

function defaultFocusScope(path: string, namespaceRoot: string): GraphScope {
  return path === namespaceRoot ? "subtree" : "exact";
}

function rewriteFocusedPath(current: string, from: string, to: string): string | null {
  if (current === from) return to;
  if (current.startsWith(`${from}/`)) return `${to}${current.slice(from.length)}`;
  return null;
}

function isUnderOrEqual(path: string, ancestor: string): boolean {
  return path === ancestor || path.startsWith(`${ancestor}/`);
}

export function MemoriesNamespacesProvider({
  children,
  namespace: namespaceProp = DEFAULT_MEMORIES_NAMESPACE,
  scope: scopeProp = "exact",
  namespaceRoot: namespaceRootProp = DEFAULT_NAMESPACE_ROOT,
}: MemoriesNamespacesProviderProps) {
  const client = useMemoriesClient();
  const { database } = useMemoriesDatabase();
  const databaseKey = `${database.kind}:${database.ownerKey}`;
  const [namespace, setNamespace] = useState(
    () => namespaceProp.trim() || DEFAULT_MEMORIES_NAMESPACE,
  );
  const [scope, setScopeState] = useState<GraphScope>(scopeProp);
  const [namespaceRoot, setNamespaceRoot] = useState(
    () => namespaceRootProp.trim() || DEFAULT_NAMESPACE_ROOT,
  );
  const [entries, setEntries] = useState<MemoriesGraphNamespaceEntry[]>([]);
  const [profiles, setProfiles] = useState<MemoriesGraphProfileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setNamespace(namespaceProp.trim() || DEFAULT_MEMORIES_NAMESPACE);
  }, [namespaceProp]);

  useEffect(() => {
    setScopeState(scopeProp);
  }, [scopeProp]);

  useEffect(() => {
    setNamespaceRoot(namespaceRootProp.trim() || DEFAULT_NAMESPACE_ROOT);
  }, [namespaceRootProp]);

  // Reset focus when the focused database changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional reset on DB switch
  useEffect(() => {
    setNamespace(namespaceProp.trim() || DEFAULT_MEMORIES_NAMESPACE);
    setScopeState(scopeProp);
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
      const json = await client.listNamespaces();
      setEntries(normalizeNamespaceEntries(json.namespaces));
      setProfiles(json.profiles ?? []);
      if (json.namespaceRoot?.trim()) {
        setNamespaceRoot(json.namespaceRoot.trim());
      }
    } catch (e) {
      setEntries([]);
      setProfiles([]);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const create = useCallback(
    async (input: CreateNamespaceInput) => {
      const path = resolveCreatePath(input);
      const pathError = validateNamespacePath(path);
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
    [client, focus, reload],
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
        setScopeState(defaultFocusScope(namespaceRoot, namespaceRoot));
        return namespaceRoot;
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
      validateSegment: validateNamespaceSegment,
      validatePath: validateNamespacePath,
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
    ],
  );

  return (
    <MemoriesNamespacesContext.Provider value={value}>
      {children}
    </MemoriesNamespacesContext.Provider>
  );
}

export function useMemoriesNamespaces(): MemoriesNamespacesValue {
  const ctx = useContext(MemoriesNamespacesContext);
  if (ctx == null) {
    throw new Error("useMemoriesNamespaces must be used within MemoriesNamespacesProvider");
  }
  return ctx;
}
