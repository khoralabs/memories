import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useMemoriesClient, useMemoriesDatabase } from "./memories-client-provider.js";
import { useMemoriesNamespaces } from "./memories-namespaces-provider.js";
import type { GraphPayload, GraphSearchState } from "./projection-types.js";

export type FocusedMemory = { kind: "node"; key: string } | { kind: "edge"; edgeId: string };

export type CatalogMemory =
  | {
      kind: "node";
      key: string;
      labels: GraphPayload["nodes"][number]["labels"];
      degree: GraphPayload["nodes"][number]["degree"];
    }
  | {
      kind: "edge";
      key: string;
      edgeId: string;
      fromKey: string;
      toKey: string;
      labels: GraphPayload["edges"][number]["labels"];
      directed?: boolean;
    };

export type MemoryContentArm = {
  key: string;
  text?: string;
  vector?: number[];
};

export type MemoryLabelArm = {
  kind: string;
  props: Record<string, unknown>;
};

export type CreateMemoryInput =
  | {
      kind: "node";
      key: string;
      namespace?: string;
      content?: MemoryContentArm[];
      labels?: MemoryLabelArm[];
    }
  | {
      kind: "edge";
      key: string;
      from_key: string;
      to_key: string;
      namespace?: string;
      content?: MemoryContentArm[];
      labels?: MemoryLabelArm[];
      directed?: boolean;
    };

export type UpdateMemoryFeaturesInput = {
  content?: MemoryContentArm[];
  labels?: MemoryLabelArm[];
  from_key?: string;
  to_key?: string;
  directed?: boolean;
};

export type MemoryFeatures = {
  labels: MemoryLabelArm[];
  content?: Array<{ sourceKey: string; text: string | null }>;
  properties?: Record<string, unknown> | null;
};

const SEARCH_DEBOUNCE_MS = 320;
const GRAPH_SEARCH_MAX_VECTOR_DISTANCE = 0.65;

function emptyPayload(namespace: string): GraphPayload {
  return { namespace, nodes: [], edges: [] };
}

function catalogFromPayload(payload: GraphPayload): CatalogMemory[] {
  const nodes: CatalogMemory[] = payload.nodes.map((n) => ({
    kind: "node" as const,
    key: n.key,
    labels: n.labels,
    degree: n.degree,
  }));
  const edges: CatalogMemory[] = payload.edges.map((e) => ({
    kind: "edge" as const,
    key: e.edgeId,
    edgeId: e.edgeId,
    fromKey: e.fromKey,
    toKey: e.toKey,
    labels: e.labels,
    ...(e.directed !== undefined ? { directed: e.directed } : {}),
  }));
  return [...nodes, ...edges];
}

export type MemoriesMemoryValue = {
  payload: GraphPayload;
  memories: CatalogMemory[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;

  searchQuery: string;
  setSearchQuery: (q: string) => void;
  graphSearch: GraphSearchState | null;
  graphSearchOverride: GraphSearchState | null;
  setGraphSearchOverride: (s: GraphSearchState | null) => void;
  searchLoading: boolean;
  /** Effective search: override ?? debounced fetch. */
  effectiveGraphSearch: GraphSearchState | null;

  focused: FocusedMemory | null;
  focusNode: (key: string) => void;
  focusEdge: (edgeId: string) => void;
  clearFocus: () => void;

  create: (input: CreateMemoryInput) => Promise<void>;
  remove: (input?: { key?: string }) => Promise<void>;
  updateFeatures: {
    (patch: UpdateMemoryFeaturesInput): Promise<void>;
    (keyOrEdgeId: string, patch: UpdateMemoryFeaturesInput): Promise<void>;
  };

  linkedEdges: (key?: string) => GraphPayload["edges"];
  features: () => Promise<MemoryFeatures>;
  getMemory: (key: string) => GraphPayload["nodes"][number] | undefined;
  getEdge: (edgeId: string) => GraphPayload["edges"][number] | undefined;
};

const MemoriesMemoryContext = createContext<MemoriesMemoryValue | null>(null);

export type MemoriesMemoryProviderProps = PropsWithChildren;

export function MemoriesMemoryProvider({ children }: MemoriesMemoryProviderProps) {
  const client = useMemoriesClient();
  const { database } = useMemoriesDatabase();
  const { namespace, scope } = useMemoriesNamespaces();
  const databaseKey = `${database.kind}:${database.ownerKey}`;

  const [payload, setPayload] = useState<GraphPayload>(() => emptyPayload(namespace.trim()));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadSeqRef = useRef(0);

  const [focused, setFocused] = useState<FocusedMemory | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [graphSearch, setGraphSearch] = useState<GraphSearchState | null>(null);
  const [graphSearchOverride, setGraphSearchOverride] = useState<GraphSearchState | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);

  const reload = useCallback(async () => {
    const loadSeq = ++loadSeqRef.current;
    setLoading(true);
    setError(null);
    const ns = namespace.trim();
    try {
      const next = await client.getGraph({
        namespace: ns,
        ...(scope === "subtree" ? { scope: "subtree" } : {}),
      });
      if (loadSeq !== loadSeqRef.current) return;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (loadSeq !== loadSeqRef.current) return;
          setPayload(next);
          setLoading(false);
          setError(null);
        });
      });
    } catch (e) {
      if (loadSeq !== loadSeqRef.current) return;
      setPayload(emptyPayload(ns));
      setError(e instanceof Error ? e.message : String(e));
      setLoading(false);
    }
  }, [client, namespace, scope]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Clear focus + search when namespace, scope, or database changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional reset on focus scope / DB
  useEffect(() => {
    setFocused(null);
    setSearchQuery("");
    setGraphSearch(null);
    setGraphSearchOverride(null);
    setSearchLoading(false);
  }, [namespace, scope, databaseKey]);

  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) {
      setGraphSearch(null);
      setSearchLoading(false);
      return;
    }
    const ac = new AbortController();
    const ns = namespace.trim();
    const id = window.setTimeout(() => {
      void (async () => {
        setSearchLoading(true);
        try {
          const json = await client.search({
            namespace: ns,
            query: q,
            topK: 10,
            maxNeighbors: 5,
            maxVectorDistance: GRAPH_SEARCH_MAX_VECTOR_DISTANCE,
            signal: ac.signal,
            ...(scope === "subtree" ? { scope: "subtree" } : { scope: "exact" }),
          });
          if (ac.signal.aborted) return;
          const hitSnippetByKey = new Map<string, string>();
          for (const row of json.hitSnippets) {
            const t = row.text?.trim();
            if (!t || hitSnippetByKey.has(row.key)) continue;
            hitSnippetByKey.set(row.key, t);
          }
          const hitSnippetByEdgeId = new Map<string, string>();
          for (const row of json.edgeHitSnippets) {
            const t = row.text?.trim();
            if (!t || hitSnippetByEdgeId.has(row.edgeId)) continue;
            hitSnippetByEdgeId.set(row.edgeId, t);
          }
          setGraphSearch({
            relevantKeys: new Set(json.keys),
            hitCount: json.hitCount,
            hitSnippetByKey,
            hitSnippetByEdgeId,
          });
        } catch {
          if (!ac.signal.aborted) setGraphSearch(null);
        } finally {
          setSearchLoading(false);
        }
      })();
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(id);
      ac.abort();
    };
  }, [client, searchQuery, namespace, scope]);

  const memories = useMemo(() => catalogFromPayload(payload), [payload]);
  const effectiveGraphSearch = graphSearchOverride ?? graphSearch;

  const focusNode = useCallback((key: string) => {
    const trimmed = key.trim();
    if (!trimmed) return;
    setFocused({ kind: "node", key: trimmed });
  }, []);

  const focusEdge = useCallback((edgeId: string) => {
    const trimmed = edgeId.trim();
    if (!trimmed) return;
    setFocused({ kind: "edge", edgeId: trimmed });
  }, []);

  const clearFocus = useCallback(() => {
    setFocused(null);
  }, []);

  const getMemory = useCallback(
    (key: string) => payload.nodes.find((n) => n.key === key),
    [payload.nodes],
  );

  const getEdge = useCallback(
    (edgeId: string) => payload.edges.find((e) => e.edgeId === edgeId),
    [payload.edges],
  );

  const linkedEdges = useCallback(
    (key?: string): GraphPayload["edges"] => {
      if (focused?.kind === "edge" && key === undefined) {
        const edge = getEdge(focused.edgeId);
        if (!edge) return [];
        return payload.edges.filter(
          (e) =>
            e.edgeId === edge.edgeId ||
            (e.fromKey === edge.fromKey && e.toKey === edge.toKey) ||
            (e.fromKey === edge.toKey && e.toKey === edge.fromKey),
        );
      }
      const nodeKey = key ?? (focused?.kind === "node" ? focused.key : null);
      if (!nodeKey) return [];
      return payload.edges.filter((e) => e.fromKey === nodeKey || e.toKey === nodeKey);
    },
    [focused, getEdge, payload.edges],
  );

  const features = useCallback(async (): Promise<MemoryFeatures> => {
    if (focused == null) throw new Error("features() requires a focused memory");
    const ns = namespace.trim();
    if (focused.kind === "node") {
      const preview = await client.getMemoryPreview({ namespace: ns, key: focused.key });
      return {
        labels: preview.labels,
        content: preview.content,
      };
    }
    const preview = await client.getEdgePreview({ namespace: ns, edgeId: focused.edgeId });
    return {
      labels: preview.labels ?? [],
      ...(preview.properties !== undefined ? { properties: preview.properties } : {}),
    };
  }, [client, focused, namespace]);

  const create = useCallback(
    async (input: CreateMemoryInput) => {
      const ns = (input.namespace ?? namespace).trim();
      if (!input.key.trim()) throw new Error("create requires a non-empty key");
      const params =
        input.kind === "node"
          ? {
              kind: "node",
              namespace: ns,
              key: input.key.trim(),
              ...(input.content !== undefined ? { content: input.content } : {}),
              ...(input.labels !== undefined ? { labels: input.labels } : {}),
            }
          : {
              kind: "edge",
              namespace: ns,
              key: input.key.trim(),
              from_key: input.from_key,
              to_key: input.to_key,
              ...(input.content !== undefined ? { content: input.content } : {}),
              ...(input.labels !== undefined ? { labels: input.labels } : {}),
              ...(input.directed !== undefined ? { directed: input.directed } : {}),
            };
      await client.mergeMemory({ params });
      await reload();
      if (input.kind === "node") focusNode(input.key);
      else focusEdge(input.key);
    },
    [client, focusEdge, focusNode, namespace, reload],
  );

  const remove = useCallback(
    async (input?: { key?: string }) => {
      const ns = namespace.trim();
      let key = input?.key?.trim();
      if (!key) {
        if (focused == null) throw new Error("remove requires a focused memory or explicit key");
        key = focused.kind === "node" ? focused.key : focused.edgeId;
      }
      await client.deleteMemory({ namespace: ns, key });
      const wasFocused =
        focused != null &&
        ((focused.kind === "node" && focused.key === key) ||
          (focused.kind === "edge" && focused.edgeId === key));
      await reload();
      if (wasFocused) setFocused(null);
    },
    [client, focused, namespace, reload],
  );

  const updateFeatures = useCallback(
    async (
      keyOrPatch: string | UpdateMemoryFeaturesInput,
      maybePatch?: UpdateMemoryFeaturesInput,
    ) => {
      const ns = namespace.trim();
      let target: FocusedMemory;
      let patch: UpdateMemoryFeaturesInput;
      if (typeof keyOrPatch === "string") {
        if (maybePatch === undefined) throw new Error("updateFeatures(key, patch) requires patch");
        patch = maybePatch;
        const asEdge = getEdge(keyOrPatch);
        target = asEdge ? { kind: "edge", edgeId: keyOrPatch } : { kind: "node", key: keyOrPatch };
      } else {
        if (focused == null) throw new Error("updateFeatures requires a focused memory");
        target = focused;
        patch = keyOrPatch;
      }

      if (target.kind === "node") {
        await client.mergeMemory({
          params: {
            kind: "node",
            namespace: ns,
            key: target.key,
            ...(patch.content !== undefined ? { content: patch.content } : {}),
            ...(patch.labels !== undefined ? { labels: patch.labels } : {}),
          },
        });
      } else {
        const edge = getEdge(target.edgeId);
        const from_key = patch.from_key ?? edge?.fromKey;
        const to_key = patch.to_key ?? edge?.toKey;
        if (!from_key || !to_key) {
          throw new Error("updateFeatures for edge requires from_key and to_key");
        }
        await client.mergeMemory({
          params: {
            kind: "edge",
            namespace: ns,
            key: target.edgeId,
            from_key,
            to_key,
            ...(patch.content !== undefined ? { content: patch.content } : {}),
            ...(patch.labels !== undefined ? { labels: patch.labels } : {}),
            ...(patch.directed !== undefined
              ? { directed: patch.directed }
              : edge?.directed !== undefined
                ? { directed: edge.directed }
                : {}),
          },
        });
      }
      await reload();
      if (typeof keyOrPatch === "string") {
        if (target.kind === "node") focusNode(target.key);
        else focusEdge(target.edgeId);
      }
    },
    [client, focusEdge, focusNode, focused, getEdge, namespace, reload],
  ) as MemoriesMemoryValue["updateFeatures"];

  const value = useMemo(
    (): MemoriesMemoryValue => ({
      payload,
      memories,
      loading,
      error,
      reload,
      searchQuery,
      setSearchQuery,
      graphSearch,
      graphSearchOverride,
      setGraphSearchOverride,
      searchLoading,
      effectiveGraphSearch,
      focused,
      focusNode,
      focusEdge,
      clearFocus,
      create,
      remove,
      updateFeatures,
      linkedEdges,
      features,
      getMemory,
      getEdge,
    }),
    [
      payload,
      memories,
      loading,
      error,
      reload,
      searchQuery,
      graphSearch,
      graphSearchOverride,
      searchLoading,
      effectiveGraphSearch,
      focused,
      focusNode,
      focusEdge,
      clearFocus,
      create,
      remove,
      updateFeatures,
      linkedEdges,
      features,
      getMemory,
      getEdge,
    ],
  );

  return <MemoriesMemoryContext.Provider value={value}>{children}</MemoriesMemoryContext.Provider>;
}

export function useMemoriesMemory(): MemoriesMemoryValue {
  const ctx = useContext(MemoriesMemoryContext);
  if (ctx == null) {
    throw new Error("useMemoriesMemory must be used within MemoriesMemoryProvider");
  }
  return ctx;
}
