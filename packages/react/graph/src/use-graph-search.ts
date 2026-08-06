import { useMemo } from "react";

import type { NamespaceSearchArms, NamespaceSearchHitResult } from "./memories-client.js";
import { useMemoriesMemory } from "./memories-memory-provider.js";
import { useMemoriesNamespaces } from "./memories-namespaces-provider.js";
import type { GraphSearchState } from "./projection-types.js";

/** Summary line for memory graph search chrome. */
export function graphSearchSummaryLine(
  queryTrimmed: string,
  graphSearch: GraphSearchState | null,
): string {
  if (queryTrimmed.length === 0) return "";
  return graphSearch
    ? `${graphSearch.hitCount} hit${graphSearch.hitCount === 1 ? "" : "s"} · ${graphSearch.relevantKeys.size} in subgraph`
    : "…";
}

/** Summary line for namespace search chrome. */
export function graphNamespaceSearchSummaryLine(
  queryTrimmed: string,
  results: NamespaceSearchHitResult[] | null,
): string {
  if (queryTrimmed.length === 0) return "";
  if (results === null) return "…";
  const n = results.length;
  return `${n} namespace${n === 1 ? "" : "s"}`;
}

export type GraphMemoriesSearchValue = {
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  searchLoading: boolean;
  graphSearch: GraphSearchState | null;
  graphSearchOverride: GraphSearchState | null;
  setGraphSearchOverride: (s: GraphSearchState | null) => void;
  effectiveGraphSearch: GraphSearchState | null;
  /** Summary for the current query + effective search state. */
  summary: string;
};

/** Chrome slice of {@link useMemoriesMemory} search state. */
export function useGraphMemoriesSearch(): GraphMemoriesSearchValue {
  const {
    searchQuery,
    setSearchQuery,
    searchLoading,
    graphSearch,
    graphSearchOverride,
    setGraphSearchOverride,
    effectiveGraphSearch,
  } = useMemoriesMemory();

  const summary = useMemo(
    () => graphSearchSummaryLine(searchQuery.trim(), effectiveGraphSearch),
    [searchQuery, effectiveGraphSearch],
  );

  return useMemo(
    () => ({
      searchQuery,
      setSearchQuery,
      searchLoading,
      graphSearch,
      graphSearchOverride,
      setGraphSearchOverride,
      effectiveGraphSearch,
      summary,
    }),
    [
      searchQuery,
      setSearchQuery,
      searchLoading,
      graphSearch,
      graphSearchOverride,
      setGraphSearchOverride,
      effectiveGraphSearch,
      summary,
    ],
  );
}

export type GraphNamespacesSearchValue = {
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  searchArms: NamespaceSearchArms;
  setSearchArms: (arms: NamespaceSearchArms) => void;
  searchUnder: string | null;
  setSearchUnder: (path: string | null) => void;
  searchResults: NamespaceSearchHitResult[] | null;
  searchLoading: boolean;
  searchError: string | null;
  /** Summary for the current query + results. */
  summary: string;
};

/** Chrome slice of {@link useMemoriesNamespaces} search state. */
export function useGraphNamespacesSearch(): GraphNamespacesSearchValue {
  const {
    searchQuery,
    setSearchQuery,
    searchArms,
    setSearchArms,
    searchUnder,
    setSearchUnder,
    searchResults,
    searchLoading,
    searchError,
  } = useMemoriesNamespaces();

  const summary = useMemo(
    () => graphNamespaceSearchSummaryLine(searchQuery.trim(), searchResults),
    [searchQuery, searchResults],
  );

  return useMemo(
    () => ({
      searchQuery,
      setSearchQuery,
      searchArms,
      setSearchArms,
      searchUnder,
      setSearchUnder,
      searchResults,
      searchLoading,
      searchError,
      summary,
    }),
    [
      searchQuery,
      setSearchQuery,
      searchArms,
      setSearchArms,
      searchUnder,
      setSearchUnder,
      searchResults,
      searchLoading,
      searchError,
      summary,
    ],
  );
}
