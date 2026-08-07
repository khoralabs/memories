import { ScanSearchIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group.js";
import { Spinner } from "@/components/ui/spinner.js";
import { cn } from "@/lib/utils";
import { useGraphMemoriesSearch } from "./use-graph-search.js";

export type GraphSearchProps = {
  className?: string;
  inputProps?: ComponentProps<typeof InputGroupInput>;
};

/**
 * Memory search row; reads {@link useGraphMemoriesSearch}.
 * Mount under {@link MemoriesNamespaceMemoriesProvider}.
 */
export function GraphSearch({ className, inputProps }: GraphSearchProps = {}) {
  const { searchQuery, setSearchQuery, searchLoading, summary } = useGraphMemoriesSearch();
  const {
    className: inputClassName,
    onChange: inputOnChange,
    value: _inputValue,
    ...restInputProps
  } = inputProps ?? {};

  return (
    <InputGroup className={cn("w-full", className)}>
      <InputGroupInput
        placeholder="Search…"
        aria-label="Search memories"
        {...restInputProps}
        value={searchQuery}
        onChange={(e) => {
          inputOnChange?.(e);
          setSearchQuery(e.target.value);
        }}
        className={inputClassName}
      />
      <InputGroupAddon>
        <ScanSearchIcon className="text-muted-foreground" aria-hidden />
      </InputGroupAddon>
      <InputGroupAddon
        align="inline-end"
        className={searchLoading ? "pr-3" : "text-xs font-normal tabular-nums"}
        aria-live={searchLoading ? "polite" : undefined}
      >
        {searchLoading ? (
          <Spinner className="text-muted-foreground" aria-label="Searching" />
        ) : (
          summary || "\u00a0"
        )}
      </InputGroupAddon>
    </InputGroup>
  );
}
