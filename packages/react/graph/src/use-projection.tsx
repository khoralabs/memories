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
import {
  type MemoriesGraphNamespaceEntry,
  type MemoriesGraphNamespacesPayload,
  namespacePathsFromEntries,
  normalizeNamespaceEntries,
} from "./lib/namespace-entries.js";
import type {
  GraphPayload,
  GraphSearchState,
  ProjectionPoint,
  SceneEdge,
} from "./projection-types.js";
import { graphLabelFingerprint, mergeSceneEdgesForPairPreview } from "./projection-types.js";

export type { MemoriesGraphNamespaceEntry } from "./lib/namespace-entries.js";

/** Default delay (ms) before debounced hover state catches up to the pointer. */
export const DEFAULT_GRAPH_FOCUS_DELAY_MS = 0;
/** Default delay (ms) after pointer leave before clearing live hover. */
export const DEFAULT_GRAPH_UNFOCUS_DELAY_MS = 0;

type HoverData = {
  neighbors: Array<{ id: string; score: number }>;
  communityMembers: string[];
};

type ProjectionValue = {
  namespace: string;
  /** Immediate hover target (memory key); use for preview fetch. */
  liveHoveredEntryId: string | null;
  /** Immediate hover target (undirected edge key); use for edge preview fetch. */
  liveHoveredEdgeKey: string | null;

  points: ProjectionPoint[];
  sceneEdges: SceneEdge[];
  graphSearch: GraphSearchState | null;

  selected: ProjectionPoint | null;
  setSelected: (p: ProjectionPoint | null) => void;

  pinnedEdge: SceneEdge | null;
  setPinnedEdge: (e: SceneEdge | null) => void;

  hoveredEntryId: string | null;
  /** Center node for subgraph dimming: click pin, else null when search drives the subgraph, else hover. */
  focusEntryId: string | null;
  /** 1-hop ego of click pin, search hits, or hover — priority: click > search > hover. */
  activeSubgraphKeys: ReadonlySet<string> | null;
  /**
   * Subgraph edge chrome: pin, search hits, or live pointer on node/edge — drives `activeOnly` edge
   * visibility and lit subgraph (same path as hover/pin).
   */
  hasGraphSubgraphFocus: boolean;
  /** Pin or search hits — directed-edge dash emphasis; excludes hover-only (matches previous pin rule). */
  hasGraphSubgraphStrongFocus: boolean;

  onHoverStart: (entryId: string) => void;
  onHoverEnd: () => void;
  onEdgeHoverStart: (edgeKey: string) => void;
  onEdgeHoverEnd: () => void;
  clearHover: () => void;
  clearPinnedSelection: () => void;
  /** Clears hover, click pin, and internal search field/results. */
  dismissPersistentGraphFocus: () => void;
  onMemoryPreviewPointerEnter: () => void;
  onMemoryPreviewPointerLeave: () => void;
  hoverData: HoverData | undefined;

  /**
   * Bottom-right preview card: debounced hover (after `focusDelay`), else pin — edge before node.
   */
  graphPreview: { kind: "node"; point: ProjectionPoint } | { kind: "edge"; edge: SceneEdge } | null;
};

const ProjectionContext = createContext<ProjectionValue | null>(null);

const DEFAULT_MEMORIES_NAMESPACE = "_global_";

export type GraphScope = "exact" | "subtree";

export type MemoriesGraphProfileEntry = {
  profileId: string;
  username?: string;
  namespace: string;
  indexed: boolean;
};

/**
 * Fetch/search chrome from {@link GraphProjectionProvider} (namespaces, graph load, search).
 *
 * Host `GET ${apiBase}/namespaces` should return:
 * `{ namespaces: MemoriesGraphNamespaceEntry[]; profiles?; namespaceRoot? }`
 * Legacy `namespaces: string[]` is still accepted and coerced.
 */
export type MemoriesGraphChromeBaseValue = {
  apiBase: string;
  namespace: string;
  setNamespace: (v: string) => void;
  namespaceRoot: string;
  scope: GraphScope;
  setScope: (scope: GraphScope) => void;
  /** Path strings derived from {@link knownNamespaceEntries} (tree / selection). */
  knownNamespaces: string[];
  /** Full catalog rows (alias/description) from the namespaces endpoint. */
  knownNamespaceEntries: MemoriesGraphNamespaceEntry[];
  knownProfiles: MemoriesGraphProfileEntry[];
  namespacesLoading: boolean;
  namespacesError: string | null;
  reloadNamespaces: () => Promise<void>;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  graphSearch: GraphSearchState | null;
  /** When set, replaces the debounced `graphSearch` driving subgraph activation and tooltips. */
  graphSearchOverride: GraphSearchState | null;
  setGraphSearchOverride: (s: GraphSearchState | null) => void;
  searchLoading: boolean;
  graphLoading: boolean;
  graphError: string | null;
  reloadGraph: () => Promise<void>;
  graphSummary: string;
  refreshAll: () => void;
};

/** Full chrome surface for UI controls (base + projection interaction when under the scene inner tree). */
export type MemoriesGraphChromeValue = MemoriesGraphChromeBaseValue & {
  hasGraphSubgraphStrongFocus: boolean;
  dismissPersistentGraphFocus: () => void;
};

const MemoriesGraphChromeBaseContext = createContext<MemoriesGraphChromeBaseValue | null>(null);

type MemoriesGraphChromeInteractionSlice = Pick<
  MemoriesGraphChromeValue,
  "hasGraphSubgraphStrongFocus" | "dismissPersistentGraphFocus"
>;

const MemoriesGraphChromeInteractionContext =
  createContext<MemoriesGraphChromeInteractionSlice | null>(null);

const DEFAULT_INTERACTION_SLICE: MemoriesGraphChromeInteractionSlice = {
  hasGraphSubgraphStrongFocus: false,
  dismissPersistentGraphFocus: () => {},
};

export function useMemoriesGraphChrome(): MemoriesGraphChromeValue {
  const base = useContext(MemoriesGraphChromeBaseContext);
  const interaction = useContext(MemoriesGraphChromeInteractionContext);
  if (!base) {
    throw new Error("useMemoriesGraphChrome must be used within GraphProjectionProvider");
  }
  const slice = interaction ?? DEFAULT_INTERACTION_SLICE;
  return useMemo(
    (): MemoriesGraphChromeValue => ({
      ...base,
      ...slice,
    }),
    [base, slice],
  );
}

function buildPoints(data: GraphPayload): ProjectionPoint[] {
  return data.nodes.map((n) => ({
    entryId: n.key,
    key: n.key,
    x: n.x,
    y: n.y,
    z: n.z,
    labels: n.labels,
    degree: n.degree,
  }));
}

function buildSceneEdges(edges: GraphPayload["edges"]): SceneEdge[] {
  const seen = new Map<
    string,
    {
      fromKey: string;
      toKey: string;
      labels: Map<string, (typeof edges)[0]["labels"][0]>;
      edgeId: string;
    }
  >();
  const directed: SceneEdge[] = [];
  for (const e of edges) {
    if (e.directed) {
      const labelMap = new Map<string, (typeof e.labels)[0]>();
      for (const lb of e.labels) labelMap.set(graphLabelFingerprint(lb), lb);
      directed.push({
        key: `${e.fromKey}\0${e.toKey}\0dir\0${e.edgeId}`,
        edgeId: e.edgeId,
        fromKey: e.fromKey,
        toKey: e.toKey,
        labels: [...labelMap.values()],
        directed: true,
      });
      continue;
    }
    const a = e.fromKey < e.toKey ? e.fromKey : e.toKey;
    const b = e.fromKey < e.toKey ? e.toKey : e.fromKey;
    const k = `${a}\0${b}`;
    const existing = seen.get(k);
    if (existing) {
      for (const lb of e.labels) existing.labels.set(graphLabelFingerprint(lb), lb);
      continue;
    }
    const labelMap = new Map<string, (typeof e.labels)[0]>();
    for (const lb of e.labels) labelMap.set(graphLabelFingerprint(lb), lb);
    seen.set(k, { fromKey: a, toKey: b, labels: labelMap, edgeId: e.edgeId });
  }
  const undirected = [...seen.entries()].map(([key, v]) => ({
    key,
    edgeId: v.edgeId,
    fromKey: v.fromKey,
    toKey: v.toKey,
    labels: [...v.labels.values()],
  }));
  return [...directed, ...undirected];
}

function expandEgoKeys(
  keys: ReadonlySet<string>,
  adjacency: Map<string, Set<string>>,
): Set<string> {
  const out = new Set<string>();
  for (const k of keys) {
    out.add(k);
    const nbrs = adjacency.get(k);
    if (nbrs) for (const n of nbrs) out.add(n);
  }
  return out;
}

function subgraphFromEdgeKey(
  edgeKey: string | null,
  sceneEdges: SceneEdge[],
): ReadonlySet<string> | null {
  if (!edgeKey) return null;
  const edge = sceneEdges.find((e) => e.key === edgeKey);
  if (!edge) return null;
  return new Set([edge.fromKey, edge.toKey]);
}

function subgraphFromNodeHover(
  nodeId: string | null,
  adjacency: Map<string, Set<string>>,
): ReadonlySet<string> | null {
  if (!nodeId) return null;
  const nbrs = adjacency.get(nodeId);
  if (!nbrs) return new Set([nodeId]);
  return new Set([nodeId, ...nbrs]);
}

function buildAdjacency(data: GraphPayload): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    let sa = m.get(a);
    if (!sa) {
      sa = new Set();
      m.set(a, sa);
    }
    sa.add(b);
  };
  for (const e of data.edges) {
    link(e.fromKey, e.toKey);
    link(e.toKey, e.fromKey);
  }
  return m;
}

type ProjectionProviderInnerProps = PropsWithChildren<{
  data: GraphPayload;
  graphSearch?: GraphSearchState | null;
  searchQuery?: string;
  onClearSearch: () => void;
  focusDelay?: number;
  unFocusDelay?: number;
}>;

export type GraphProjectionProviderProps = PropsWithChildren<{
  /** Initial / reset seed; user can override via the namespace selector in chrome. */
  namespace?: string;
  /** Graph query scope: exact namespace or subtree under prefix (default `exact`). */
  scope?: GraphScope;
  /** API prefix for graph endpoints (default `/api`). */
  apiBase?: string;
  focusDelay?: number;
  unFocusDelay?: number;
}>;

const DEFAULT_API_BASE = "/api";

function normalizeApiBase(base: string | undefined): string {
  const trimmed = (base ?? DEFAULT_API_BASE).trim() || DEFAULT_API_BASE;
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

function ProjectionProviderInner({
  children,
  data,
  graphSearch = null,
  searchQuery = "",
  onClearSearch,
  focusDelay = DEFAULT_GRAPH_FOCUS_DELAY_MS,
  unFocusDelay = DEFAULT_GRAPH_UNFOCUS_DELAY_MS,
}: ProjectionProviderInnerProps) {
  const points = useMemo(() => buildPoints(data), [data]);
  const sceneEdges = useMemo(() => buildSceneEdges(data.edges), [data.edges]);
  const adjacency = useMemo(() => buildAdjacency(data), [data]);

  const [selected, setSelectedInternal] = useState<ProjectionPoint | null>(null);
  const [pinnedEdge, setPinnedEdgeInternal] = useState<SceneEdge | null>(null);
  const [rawHoveredId, setRawHoveredId] = useState<string | null>(null);
  const [debouncedHoveredId, setDebouncedHoveredId] = useState<string | null>(null);
  const [rawHoveredEdgeKey, setRawHoveredEdgeKey] = useState<string | null>(null);
  const [debouncedHoveredEdgeKey, setDebouncedHoveredEdgeKey] = useState<string | null>(null);
  const hoverClearTimerRef = useRef<number | null>(null);
  const edgeHoverClearTimerRef = useRef<number | null>(null);

  const cancelScheduledHoverClear = useCallback(() => {
    if (hoverClearTimerRef.current !== null) {
      window.clearTimeout(hoverClearTimerRef.current);
      hoverClearTimerRef.current = null;
    }
  }, []);

  const cancelScheduledEdgeHoverClear = useCallback(() => {
    if (edgeHoverClearTimerRef.current !== null) {
      window.clearTimeout(edgeHoverClearTimerRef.current);
      edgeHoverClearTimerRef.current = null;
    }
  }, []);

  const cancelAllHoverTimers = useCallback(() => {
    cancelScheduledHoverClear();
    cancelScheduledEdgeHoverClear();
  }, [cancelScheduledHoverClear, cancelScheduledEdgeHoverClear]);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedHoveredId(rawHoveredId), focusDelay);
    return () => window.clearTimeout(t);
  }, [rawHoveredId, focusDelay]);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedHoveredEdgeKey(rawHoveredEdgeKey), focusDelay);
    return () => window.clearTimeout(t);
  }, [rawHoveredEdgeKey, focusDelay]);

  const setSelected = useCallback((p: ProjectionPoint | null) => {
    setPinnedEdgeInternal(null);
    setSelectedInternal(p);
  }, []);

  const setPinnedEdge = useCallback((e: SceneEdge | null) => {
    setSelectedInternal(null);
    setPinnedEdgeInternal(e);
  }, []);

  const onHoverStart = useCallback(
    (entryId: string) => {
      cancelAllHoverTimers();
      setRawHoveredEdgeKey(null);
      setRawHoveredId(entryId);
    },
    [cancelAllHoverTimers],
  );

  const onHoverEnd = useCallback(() => {
    cancelScheduledHoverClear();
    const id = window.setTimeout(() => {
      hoverClearTimerRef.current = null;
      setRawHoveredId(null);
    }, unFocusDelay);
    hoverClearTimerRef.current = id;
  }, [cancelScheduledHoverClear, unFocusDelay]);

  const onEdgeHoverStart = useCallback(
    (edgeKey: string) => {
      cancelAllHoverTimers();
      setRawHoveredId(null);
      setRawHoveredEdgeKey(edgeKey);
    },
    [cancelAllHoverTimers],
  );

  const onEdgeHoverEnd = useCallback(() => {
    cancelScheduledEdgeHoverClear();
    const id = window.setTimeout(() => {
      edgeHoverClearTimerRef.current = null;
      setRawHoveredEdgeKey(null);
    }, unFocusDelay);
    edgeHoverClearTimerRef.current = id;
  }, [cancelScheduledEdgeHoverClear, unFocusDelay]);

  const clearHover = useCallback(() => {
    cancelAllHoverTimers();
    setRawHoveredId(null);
    setRawHoveredEdgeKey(null);
  }, [cancelAllHoverTimers]);

  const clearPinnedSelection = useCallback(() => {
    setSelectedInternal(null);
    setPinnedEdgeInternal(null);
  }, []);

  const dismissPersistentGraphFocus = useCallback(() => {
    clearHover();
    clearPinnedSelection();
    onClearSearch();
  }, [clearHover, clearPinnedSelection, onClearSearch]);

  const onMemoryPreviewPointerEnter = useCallback(() => {
    cancelAllHoverTimers();
  }, [cancelAllHoverTimers]);

  const onMemoryPreviewPointerLeave = useCallback(() => {
    cancelAllHoverTimers();
    setRawHoveredId(null);
    setRawHoveredEdgeKey(null);
  }, [cancelAllHoverTimers]);

  useEffect(
    () => () => {
      cancelAllHoverTimers();
    },
    [cancelAllHoverTimers],
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismissPersistentGraphFocus();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [dismissPersistentGraphFocus]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: clear click-pin when search text or fetched results change
  useEffect(() => {
    setSelectedInternal(null);
    setPinnedEdgeInternal(null);
  }, [searchQuery, graphSearch]);

  const hoverData = useMemo((): HoverData | undefined => {
    if (!debouncedHoveredId) return undefined;
    const nbrs = adjacency.get(debouncedHoveredId);
    if (!nbrs) return { neighbors: [], communityMembers: [debouncedHoveredId] };
    const neighbors = [...nbrs].map((id) => ({ id, score: 1 }));
    return {
      neighbors,
      communityMembers: [debouncedHoveredId, ...neighbors.map((n) => n.id)],
    };
  }, [adjacency, debouncedHoveredId]);

  const searchSubgraphKeys = useMemo((): ReadonlySet<string> | null => {
    if (!graphSearch || graphSearch.relevantKeys.size === 0) return null;
    return expandEgoKeys(graphSearch.relevantKeys, adjacency);
  }, [graphSearch, adjacency]);

  const focusEntryId =
    selected?.entryId ?? (searchSubgraphKeys ? null : (debouncedHoveredId ?? rawHoveredId ?? null));

  const activeSubgraphKeys = useMemo((): ReadonlySet<string> | null => {
    if (selected) {
      const nbrs = adjacency.get(selected.entryId);
      if (!nbrs) return new Set([selected.entryId]);
      return new Set([selected.entryId, ...nbrs]);
    }
    if (pinnedEdge) {
      return new Set([pinnedEdge.fromKey, pinnedEdge.toKey]);
    }
    if (searchSubgraphKeys) return searchSubgraphKeys;
    // Hover ego follows debounced ids so `focusDelay` controls subgraph timing (see edge `subgraphLit` when null).
    return (
      subgraphFromEdgeKey(debouncedHoveredEdgeKey, sceneEdges) ??
      subgraphFromNodeHover(debouncedHoveredId, adjacency)
    );
  }, [
    selected,
    pinnedEdge,
    searchSubgraphKeys,
    debouncedHoveredEdgeKey,
    debouncedHoveredId,
    sceneEdges,
    adjacency,
  ]);

  const searchDrivesSubgraph = graphSearch !== null && graphSearch.relevantKeys.size > 0;

  const hasGraphSubgraphStrongFocus =
    selected !== null || pinnedEdge !== null || searchDrivesSubgraph;

  const hasGraphSubgraphFocus =
    hasGraphSubgraphStrongFocus || rawHoveredId !== null || rawHoveredEdgeKey !== null;

  const graphPreview = useMemo((): ProjectionValue["graphPreview"] => {
    if (debouncedHoveredEdgeKey) {
      const edge = sceneEdges.find((e) => e.key === debouncedHoveredEdgeKey);
      return edge ? { kind: "edge", edge: mergeSceneEdgesForPairPreview(edge, sceneEdges) } : null;
    }
    if (debouncedHoveredId) {
      const point = points.find((p) => p.entryId === debouncedHoveredId);
      return point ? { kind: "node", point } : null;
    }
    if (pinnedEdge) {
      return {
        kind: "edge",
        edge: mergeSceneEdgesForPairPreview(pinnedEdge, sceneEdges),
      };
    }
    if (selected) return { kind: "node", point: selected };
    return null;
  }, [debouncedHoveredEdgeKey, debouncedHoveredId, pinnedEdge, selected, sceneEdges, points]);

  const value = useMemo(
    (): ProjectionValue => ({
      namespace: data.namespace,
      liveHoveredEntryId: rawHoveredId,
      liveHoveredEdgeKey: rawHoveredEdgeKey,
      points,
      sceneEdges,
      graphSearch,
      selected,
      setSelected,
      pinnedEdge,
      setPinnedEdge,
      hoveredEntryId: debouncedHoveredId,
      focusEntryId,
      activeSubgraphKeys,
      hasGraphSubgraphFocus,
      hasGraphSubgraphStrongFocus,
      onHoverStart,
      onHoverEnd,
      onEdgeHoverStart,
      onEdgeHoverEnd,
      clearHover,
      clearPinnedSelection,
      dismissPersistentGraphFocus,
      onMemoryPreviewPointerEnter,
      onMemoryPreviewPointerLeave,
      hoverData,
      graphPreview,
    }),
    [
      data.namespace,
      rawHoveredId,
      rawHoveredEdgeKey,
      points,
      sceneEdges,
      graphSearch,
      selected,
      setSelected,
      pinnedEdge,
      setPinnedEdge,
      debouncedHoveredId,
      focusEntryId,
      activeSubgraphKeys,
      hasGraphSubgraphFocus,
      hasGraphSubgraphStrongFocus,
      onHoverStart,
      onHoverEnd,
      onEdgeHoverStart,
      onEdgeHoverEnd,
      clearHover,
      clearPinnedSelection,
      dismissPersistentGraphFocus,
      onMemoryPreviewPointerEnter,
      onMemoryPreviewPointerLeave,
      hoverData,
      graphPreview,
    ],
  );

  const interactionChrome = useMemo(
    (): MemoriesGraphChromeInteractionSlice => ({
      hasGraphSubgraphStrongFocus,
      dismissPersistentGraphFocus,
    }),
    [hasGraphSubgraphStrongFocus, dismissPersistentGraphFocus],
  );

  return (
    <MemoriesGraphChromeInteractionContext.Provider value={interactionChrome}>
      <ProjectionContext.Provider value={value}>{children}</ProjectionContext.Provider>
    </MemoriesGraphChromeInteractionContext.Provider>
  );
}

const SEARCH_DEBOUNCE_MS = 320;
const GRAPH_SEARCH_MAX_VECTOR_DISTANCE = 0.65;

export function GraphProjectionProvider({
  children,
  namespace: namespaceProp = DEFAULT_MEMORIES_NAMESPACE,
  scope: scopeProp = "exact",
  apiBase: apiBaseProp,
  focusDelay = DEFAULT_GRAPH_FOCUS_DELAY_MS,
  unFocusDelay = DEFAULT_GRAPH_UNFOCUS_DELAY_MS,
}: GraphProjectionProviderProps) {
  const apiBase = useMemo(() => normalizeApiBase(apiBaseProp), [apiBaseProp]);
  const seed = namespaceProp.trim() || DEFAULT_MEMORIES_NAMESPACE;
  const [namespace, setNamespace] = useState(seed);
  const [scope, setScope] = useState<GraphScope>(scopeProp);
  useEffect(() => {
    setNamespace(namespaceProp.trim() || DEFAULT_MEMORIES_NAMESPACE);
  }, [namespaceProp]);
  useEffect(() => {
    setScope(scopeProp);
  }, [scopeProp]);

  const [fetchedPayload, setFetchedPayload] = useState<GraphPayload | null>(null);
  const [graphLoading, setGraphLoading] = useState(true);
  const [graphError, setGraphError] = useState<string | null>(null);
  const graphLoadSeqRef = useRef(0);

  const [knownNamespaceEntries, setKnownNamespaceEntries] = useState<MemoriesGraphNamespaceEntry[]>(
    [],
  );
  const knownNamespaces = useMemo(
    () => namespacePathsFromEntries(knownNamespaceEntries),
    [knownNamespaceEntries],
  );
  const [knownProfiles, setKnownProfiles] = useState<MemoriesGraphProfileEntry[]>([]);
  const [namespaceRoot, setNamespaceRoot] = useState("global");
  const [namespacesLoading, setNamespacesLoading] = useState(false);
  const [namespacesError, setNamespacesError] = useState<string | null>(null);

  const reloadNamespaces = useCallback(async () => {
    setNamespacesLoading(true);
    setNamespacesError(null);
    try {
      const res = await fetch(`${apiBase}/namespaces`);
      const json = (await res.json()) as MemoriesGraphNamespacesPayload & {
        profiles?: MemoriesGraphProfileEntry[];
      };
      if (!res.ok) {
        setKnownNamespaceEntries([]);
        setKnownProfiles([]);
        setNamespacesError(json.error ?? res.statusText);
        return;
      }
      if (json.error) {
        setKnownNamespaceEntries([]);
        setKnownProfiles([]);
        setNamespacesError(json.error);
        return;
      }
      setKnownNamespaceEntries(normalizeNamespaceEntries(json.namespaces));
      setKnownProfiles(json.profiles ?? []);
      if (json.namespaceRoot?.trim()) {
        setNamespaceRoot(json.namespaceRoot.trim());
      }
    } catch (e) {
      setKnownNamespaceEntries([]);
      setKnownProfiles([]);
      setNamespacesError(String(e));
    } finally {
      setNamespacesLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    void reloadNamespaces();
  }, [reloadNamespaces]);

  const loadGraph = useCallback(async () => {
    const loadSeq = ++graphLoadSeqRef.current;
    setGraphLoading(true);
    setGraphError(null);
    const ns = namespace.trim();
    try {
      const scopeParam = scope === "subtree" ? "&scope=subtree" : "";
      const res = await fetch(`${apiBase}/graph?namespace=${encodeURIComponent(ns)}${scopeParam}`);
      const json = (await res.json()) as GraphPayload & { error?: string };
      if (loadSeq !== graphLoadSeqRef.current) return;
      if (!res.ok) {
        setFetchedPayload(null);
        setGraphError(json.error ?? res.statusText);
        setGraphLoading(false);
        return;
      }
      if ("error" in json && json.error) {
        setFetchedPayload(null);
        setGraphError(json.error);
        setGraphLoading(false);
        return;
      }
      const payload: GraphPayload = {
        namespace: json.namespace,
        nodes: json.nodes ?? [],
        edges: json.edges ?? [],
      };
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (loadSeq !== graphLoadSeqRef.current) return;
          setFetchedPayload(payload);
          setGraphLoading(false);
          setGraphError(null);
        });
      });
    } catch (e) {
      if (loadSeq !== graphLoadSeqRef.current) return;
      setFetchedPayload(null);
      setGraphError(String(e));
      setGraphLoading(false);
    }
  }, [apiBase, namespace, scope]);

  useEffect(() => {
    void loadGraph();
  }, [loadGraph]);

  const [searchQuery, setSearchQuery] = useState("");
  const [graphSearch, setGraphSearch] = useState<GraphSearchState | null>(null);
  const [graphSearchOverride, setGraphSearchOverride] = useState<GraphSearchState | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);

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
          const res = await fetch(`${apiBase}/search`, {
            method: "POST",
            signal: ac.signal,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              namespace: ns,
              query: q,
              topK: 10,
              maxNeighbors: 5,
              maxVectorDistance: GRAPH_SEARCH_MAX_VECTOR_DISTANCE,
              ...(scope === "subtree" ? { scope: "subtree" } : {}),
            }),
          });
          const json = (await res.json()) as {
            hitCount?: number;
            keys?: string[];
            hitSnippets?: Array<{ key?: string; text?: string | null }>;
            edgeHitSnippets?: Array<{
              edgeId?: string;
              text?: string | null;
            }>;
            error?: string;
          };
          if (ac.signal.aborted) return;
          if (!res.ok || json.error) {
            setGraphSearch(null);
            return;
          }
          const hitSnippetByKey = new Map<string, string>();
          for (const row of json.hitSnippets ?? []) {
            const k = row.key?.trim();
            const t = row.text?.trim();
            if (!k || !t || hitSnippetByKey.has(k)) continue;
            hitSnippetByKey.set(k, t);
          }
          const hitSnippetByEdgeId = new Map<string, string>();
          for (const row of json.edgeHitSnippets ?? []) {
            const id = row.edgeId?.trim();
            const t = row.text?.trim();
            if (!id || !t || hitSnippetByEdgeId.has(id)) continue;
            hitSnippetByEdgeId.set(id, t);
          }
          setGraphSearch({
            relevantKeys: new Set(json.keys ?? []),
            hitCount: json.hitCount ?? 0,
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
  }, [apiBase, searchQuery, namespace, scope]);

  const effectiveData = useMemo((): GraphPayload => {
    return (
      fetchedPayload ?? {
        namespace: namespace.trim(),
        nodes: [],
        edges: [],
      }
    );
  }, [fetchedPayload, namespace]);

  const graphSummary = useMemo(() => {
    if (!fetchedPayload) return "";
    return `${fetchedPayload.nodes.length} nodes · ${fetchedPayload.edges.length} edges`;
  }, [fetchedPayload]);

  const clearSearch = useCallback(() => setSearchQuery(""), []);

  const refreshAll = useCallback(() => {
    void loadGraph();
    void reloadNamespaces();
  }, [loadGraph, reloadNamespaces]);

  const effectiveGraphSearch = graphSearchOverride ?? graphSearch;

  const chromeValue = useMemo(
    (): MemoriesGraphChromeBaseValue => ({
      apiBase,
      namespace,
      setNamespace,
      namespaceRoot,
      scope,
      setScope,
      knownNamespaces,
      knownNamespaceEntries,
      knownProfiles,
      namespacesLoading,
      namespacesError,
      reloadNamespaces,
      searchQuery,
      setSearchQuery,
      graphSearch: effectiveGraphSearch,
      graphSearchOverride,
      setGraphSearchOverride,
      searchLoading,
      graphLoading,
      graphError,
      reloadGraph: loadGraph,
      graphSummary,
      refreshAll,
    }),
    [
      apiBase,
      namespace,
      namespaceRoot,
      scope,
      knownNamespaces,
      knownNamespaceEntries,
      knownProfiles,
      namespacesLoading,
      namespacesError,
      reloadNamespaces,
      searchQuery,
      effectiveGraphSearch,
      graphSearchOverride,
      searchLoading,
      graphLoading,
      graphError,
      loadGraph,
      graphSummary,
      refreshAll,
    ],
  );

  return (
    <MemoriesGraphChromeBaseContext.Provider value={chromeValue}>
      <ProjectionProviderInner
        data={effectiveData}
        graphSearch={effectiveGraphSearch}
        searchQuery={searchQuery}
        focusDelay={focusDelay}
        unFocusDelay={unFocusDelay}
        onClearSearch={clearSearch}
      >
        {children}
      </ProjectionProviderInner>
    </MemoriesGraphChromeBaseContext.Provider>
  );
}

export function useProjection(): ProjectionValue {
  const ctx = useContext(ProjectionContext);
  if (!ctx) throw new Error("useProjection must be used within GraphProjectionProvider");
  return ctx;
}
