import { FolderSearchIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group.js";
import { Spinner } from "@/components/ui/spinner.js";
import { cn } from "@/lib/utils";
import { useGraphNamespacesSearch } from "./use-graph-search.js";

export type GraphNamespaceSearchProps = {
  className?: string;
  inputProps?: ComponentProps<typeof InputGroupInput>;
};

/**
 * Namespace search row; reads {@link useGraphNamespacesSearch}.
 * Mount under {@link MemoriesNamespacesProvider}. Pair with
 * {@link GraphNamespaceTree} — Hierarchy filters to ranked `searchResults`.
 */
export function GraphNamespaceSearch({ className, inputProps }: GraphNamespaceSearchProps = {}) {
  const { searchQuery, setSearchQuery, searchLoading, summary } = useGraphNamespacesSearch();
  const {
    className: inputClassName,
    onChange: inputOnChange,
    value: _inputValue,
    ...restInputProps
  } = inputProps ?? {};

  return (
    <InputGroup className={cn("w-full", className)}>
      <InputGroupInput
        placeholder="Search namespaces…"
        aria-label="Search namespaces"
        {...restInputProps}
        value={searchQuery}
        onChange={(e) => {
          inputOnChange?.(e);
          setSearchQuery(e.target.value);
        }}
        className={inputClassName}
      />
      <InputGroupAddon>
        <FolderSearchIcon className="text-muted-foreground" aria-hidden />
      </InputGroupAddon>
      <InputGroupAddon
        align="inline-end"
        className={searchLoading ? "pr-3" : "text-xs font-normal tabular-nums"}
        aria-live={searchLoading ? "polite" : undefined}
      >
        {searchLoading ? (
          <Spinner className="text-muted-foreground" aria-label="Searching namespaces" />
        ) : (
          summary || "\u00a0"
        )}
      </InputGroupAddon>
    </InputGroup>
  );
}
