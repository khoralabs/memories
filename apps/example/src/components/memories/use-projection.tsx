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
import { useMemoriesMemory } from "@/components/memories/memories-memory-provider";
import { useMemoriesNamespaces } from "@/components/memories/memories-namespaces-provider";
import type {
  GraphPayload,
  GraphSearchState,
  ProjectionPoint,
  SceneEdge,
} from "@/components/memories/projection-types";
import {
  graphLabelFingerprint,
  mergeSceneEdgesForPairPreview,
} from "@/components/memories/projection-types";

export type {
  GraphScope,
  MemoriesGraphProfileEntry,
} from "@/components/memories/memories-namespaces-provider";
export type { MemoriesGraphNamespaceEntry } from "@/lib/namespace-entries";

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

/**
 * Graph chrome from {@link GraphProjectionProvider} (load / refresh / Esc).
 * Memory search: {@link useGraphMemoriesSearch}. Namespace catalog: {@link useMemoriesNamespaces}.
 * Mount {@link MemoriesClientProvider} → {@link MemoriesNamespacesProvider} →
 * {@link MemoriesNamespaceMemoriesProvider} → this provider.
 */
export type MemoriesGraphChromeBaseValue = {
  graphLoading: boolean;
  graphError: string | null;
  reloadGraph: () => Promise<void>;
  graphSummary: string;
  /** Reloads namespace catalog + memory catalog (graph payload). */
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

/**
 * Load / refresh / Esc chrome under {@link GraphProjectionProvider}.
 * For memory search box state, use {@link useGraphMemoriesSearch}.
 */
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

/**
 * Props for {@link GraphProjectionProvider}.
 *
 * Scene/interaction layer only: does not fetch catalogs, run search, or perform CRUD.
 * Those live on {@link MemoriesNamespacesProvider} and {@link MemoriesNamespaceMemoriesProvider}.
 */
export type GraphProjectionProviderProps = PropsWithChildren<{
  /**
   * Milliseconds before live pointer hover becomes debounced hover.
   * Debounced hover drives subgraph dimming and the bottom-right preview dock (`useProjection().graphPreview`).
   * @default DEFAULT_GRAPH_FOCUS_DELAY_MS
   */
  focusDelay?: number;
  /**
   * Milliseconds after pointer leave before clearing live hover (node or edge).
   * @default DEFAULT_GRAPH_UNFOCUS_DELAY_MS
   */
  unFocusDelay?: number;
}>;

function ProjectionProviderInner({
  children,
  data,
  graphSearch = null,
  searchQuery = "",
  onClearSearch,
  focusDelay = DEFAULT_GRAPH_FOCUS_DELAY_MS,
  unFocusDelay = DEFAULT_GRAPH_UNFOCUS_DELAY_MS,
}: ProjectionProviderInnerProps) {
  const { focused, focusNode, focusEdge, clearFocus } = useMemoriesMemory();
  const points = useMemo(() => buildPoints(data), [data]);
  const sceneEdges = useMemo(() => buildSceneEdges(data.edges), [data.edges]);
  const adjacency = useMemo(() => buildAdjacency(data), [data]);

  const selected = useMemo((): ProjectionPoint | null => {
    if (focused?.kind !== "node") return null;
    return points.find((p) => p.entryId === focused.key) ?? null;
  }, [focused, points]);

  const pinnedEdge = useMemo((): SceneEdge | null => {
    if (focused?.kind !== "edge") return null;
    return sceneEdges.find((e) => e.edgeId === focused.edgeId) ?? null;
  }, [focused, sceneEdges]);

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

  const setSelected = useCallback(
    (p: ProjectionPoint | null) => {
      if (p == null) clearFocus();
      else focusNode(p.entryId);
    },
    [clearFocus, focusNode],
  );

  const setPinnedEdge = useCallback(
    (e: SceneEdge | null) => {
      if (e == null) clearFocus();
      else focusEdge(e.edgeId);
    },
    [clearFocus, focusEdge],
  );

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
    clearFocus();
  }, [clearFocus]);

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
    clearFocus();
  }, [searchQuery, graphSearch, clearFocus]);

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

/**
 * Projects namespace-scoped memory catalog data into 3D scene state and pointer interaction.
 *
 * @remarks
 * Mount order (required):
 * {@link MemoriesClientProvider} → {@link MemoriesNamespacesProvider} →
 * {@link MemoriesNamespaceMemoriesProvider} → {@link GraphProjectionProvider}.
 *
 * Consumes `payload`, search, and memory focus from {@link useMemoriesMemory}
 * (no second `getGraph`). Owns points/sceneEdges, hover/pin, subgraph focus sets,
 * preview dock selection, and load/refresh/Esc chrome via {@link useMemoriesGraphChrome}.
 *
 * Memory search UI should use {@link useGraphMemoriesSearch} / {@link GraphSearch},
 * not the chrome hook.
 *
 * @param props - Timing delays for hover debounce / unfocus; children are scene + chrome
 */
export function GraphProjectionProvider({
  children,
  focusDelay = DEFAULT_GRAPH_FOCUS_DELAY_MS,
  unFocusDelay = DEFAULT_GRAPH_UNFOCUS_DELAY_MS,
}: GraphProjectionProviderProps) {
  const { reload: reloadNamespaces, namespace } = useMemoriesNamespaces();
  const {
    payload,
    loading: graphLoading,
    error: graphError,
    reload: reloadGraph,
    searchQuery,
    setSearchQuery,
    setGraphSearchOverride,
    effectiveGraphSearch,
  } = useMemoriesMemory();

  const graphSummary = useMemo(() => {
    if (graphLoading && payload.nodes.length === 0 && payload.edges.length === 0) return "";
    return `${payload.nodes.length} nodes · ${payload.edges.length} edges`;
  }, [graphLoading, payload.edges.length, payload.nodes.length]);

  const clearSearch = useCallback(() => {
    setSearchQuery("");
    setGraphSearchOverride(null);
  }, [setSearchQuery, setGraphSearchOverride]);

  const refreshAll = useCallback(() => {
    void reloadGraph();
    void reloadNamespaces();
  }, [reloadGraph, reloadNamespaces]);

  const chromeValue = useMemo(
    (): MemoriesGraphChromeBaseValue => ({
      graphLoading,
      graphError,
      reloadGraph,
      graphSummary,
      refreshAll,
    }),
    [graphLoading, graphError, reloadGraph, graphSummary, refreshAll],
  );

  const effectiveData = useMemo((): GraphPayload => {
    if (payload.namespace) return payload;
    return { namespace: namespace.trim(), nodes: payload.nodes, edges: payload.edges };
  }, [payload, namespace]);

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
