import { ScanSearchIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { createGraphSearchField } from "@/components/graph-search-field";
import type { InputGroup } from "@/components/ui/input-group";
import { useGraphMemoriesSearch } from "@/hooks/use-graph-search";

/**
 * Memory search row; reads {@link useGraphMemoriesSearch}.
 * Mount under {@link MemoriesNamespaceMemoriesProvider}.
 *
 * @example Default chrome
 * ```tsx
 * <GraphSearch />
 * ```
 *
 * @example Compose addons
 * ```tsx
 * <GraphSearch>
 *   <GraphSearch.Input />
 *   <GraphSearch.Addon>…</GraphSearch.Addon>
 *   <GraphSearch.Addon align="inline-end">
 *     <GraphSearch.Loading />
 *   </GraphSearch.Addon>
 * </GraphSearch>
 * ```
 */
export const GraphSearch = createGraphSearchField({
  displayName: "GraphSearch",
  useSearch: () => {
    const { searchQuery, setSearchQuery, searchLoading, summary } = useGraphMemoriesSearch();
    return { searchQuery, setSearchQuery, searchLoading, summary };
  },
  defaultPlaceholder: "Search…",
  defaultAriaLabel: "Search memories",
  loadingAriaLabel: "Searching",
  StartIcon: ScanSearchIcon,
});

export type GraphSearchProps = ComponentProps<typeof InputGroup>;
