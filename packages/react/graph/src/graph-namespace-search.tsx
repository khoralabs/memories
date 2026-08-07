import { FolderSearchIcon } from "lucide-react";
import type { ComponentProps } from "react";
import type { InputGroup, InputGroupInput } from "@/components/ui/input-group.js";
import { createGraphSearchField } from "./lib/graph-search-field.js";
import { useGraphNamespacesSearch } from "./use-graph-search.js";

/**
 * Namespace search row; reads {@link useGraphNamespacesSearch}.
 * Mount under {@link MemoriesNamespacesProvider}. Pair with
 * {@link GraphNamespaceTree} — Hierarchy filters to ranked `searchResults`.
 *
 * @example Default chrome
 * ```tsx
 * <GraphNamespaceSearch />
 * ```
 *
 * @example Compose addons
 * ```tsx
 * <GraphNamespaceSearch>
 *   <GraphNamespaceSearch.Input />
 *   <GraphNamespaceSearch.Addon>…</GraphNamespaceSearch.Addon>
 *   <GraphNamespaceSearch.Addon align="inline-end">
 *     <GraphNamespaceSearch.Loading />
 *   </GraphNamespaceSearch.Addon>
 * </GraphNamespaceSearch>
 * ```
 */
export const GraphNamespaceSearch = createGraphSearchField({
  displayName: "GraphNamespaceSearch",
  useSearch: () => {
    const { searchQuery, setSearchQuery, searchLoading, summary } = useGraphNamespacesSearch();
    return { searchQuery, setSearchQuery, searchLoading, summary };
  },
  defaultPlaceholder: "Search namespaces…",
  defaultAriaLabel: "Search namespaces",
  loadingAriaLabel: "Searching namespaces",
  StartIcon: FolderSearchIcon,
});

export type GraphNamespaceSearchProps = ComponentProps<typeof InputGroup> & {
  /** @deprecated Prefer `<GraphNamespaceSearch.Input {…} />` when composing. */
  inputProps?: ComponentProps<typeof InputGroupInput>;
};
