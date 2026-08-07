import type { LucideIcon } from "lucide-react";
import { Children, type ComponentProps, createContext, type ReactNode, useContext } from "react";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group.js";
import { Spinner } from "@/components/ui/spinner.js";
import { cn } from "@/lib/utils";

export type GraphSearchFieldSlice = {
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  searchLoading: boolean;
  summary: string;
};

export type CreateGraphSearchFieldOptions = {
  useSearch: () => GraphSearchFieldSlice;
  defaultPlaceholder: string;
  defaultAriaLabel: string;
  loadingAriaLabel: string;
  StartIcon: LucideIcon;
  /** displayName prefix, e.g. "GraphSearch" */
  displayName: string;
};

type GraphSearchFieldContextValue = GraphSearchFieldSlice & {
  defaultPlaceholder: string;
  defaultAriaLabel: string;
  loadingAriaLabel: string;
};

export function createGraphSearchField(opts: CreateGraphSearchFieldOptions) {
  const {
    useSearch,
    defaultPlaceholder,
    defaultAriaLabel,
    loadingAriaLabel,
    StartIcon,
    displayName,
  } = opts;

  const SearchFieldContext = createContext<GraphSearchFieldContextValue | null>(null);

  function useSearchFieldContext(part: string): GraphSearchFieldContextValue {
    const ctx = useContext(SearchFieldContext);
    if (ctx == null) {
      throw new Error(`${displayName}.${part} must be used within ${displayName}`);
    }
    return ctx;
  }

  function SearchInput({
    className,
    onChange,
    value: _value,
    placeholder = defaultPlaceholder,
    "aria-label": ariaLabel = defaultAriaLabel,
    ...props
  }: ComponentProps<typeof InputGroupInput>) {
    const { searchQuery, setSearchQuery } = useSearchFieldContext("Input");
    return (
      <InputGroupInput
        placeholder={placeholder}
        aria-label={ariaLabel}
        {...props}
        value={searchQuery}
        onChange={(e) => {
          onChange?.(e);
          setSearchQuery(e.target.value);
        }}
        className={className}
      />
    );
  }
  SearchInput.displayName = `${displayName}.Input`;

  function SearchAddon(props: ComponentProps<typeof InputGroupAddon>) {
    useSearchFieldContext("Addon");
    return <InputGroupAddon {...props} />;
  }
  SearchAddon.displayName = `${displayName}.Addon`;

  function SearchLoading({ className, ...props }: ComponentProps<typeof Spinner>) {
    const { searchLoading, summary } = useSearchFieldContext("Loading");
    if (searchLoading) {
      return (
        <Spinner
          className={cn("text-muted-foreground", className)}
          aria-label={loadingAriaLabel}
          {...props}
        />
      );
    }
    return <>{summary || "\u00a0"}</>;
  }
  SearchLoading.displayName = `${displayName}.Loading`;

  function DefaultChildren({
    inputProps,
  }: {
    inputProps?: ComponentProps<typeof InputGroupInput>;
  }) {
    const { searchLoading } = useSearchFieldContext("Root");
    return (
      <>
        <SearchInput {...inputProps} />
        <SearchAddon>
          <StartIcon className="text-muted-foreground" aria-hidden />
        </SearchAddon>
        <SearchAddon
          align="inline-end"
          className={searchLoading ? "pr-3" : "text-xs font-normal tabular-nums"}
          aria-live={searchLoading ? "polite" : undefined}
        >
          <SearchLoading />
        </SearchAddon>
      </>
    );
  }

  function hasRenderableChildren(children: ReactNode | undefined): boolean {
    if (children == null || children === false) return false;
    let found = false;
    Children.forEach(children, (child) => {
      if (child != null && child !== false) found = true;
    });
    return found;
  }

  type RootProps = ComponentProps<typeof InputGroup> & {
    /**
     * @deprecated Prefer composing `<….Input {…} />`.
     * Applied to the default `.Input` only when `children` are omitted.
     */
    inputProps?: ComponentProps<typeof InputGroupInput>;
  };

  function SearchRoot({ className, children, inputProps, ...props }: RootProps) {
    const slice = useSearch();
    const value: GraphSearchFieldContextValue = {
      ...slice,
      defaultPlaceholder,
      defaultAriaLabel,
      loadingAriaLabel,
    };
    return (
      <SearchFieldContext.Provider value={value}>
        <InputGroup className={cn("w-full", className)} {...props}>
          {hasRenderableChildren(children) ? children : <DefaultChildren inputProps={inputProps} />}
        </InputGroup>
      </SearchFieldContext.Provider>
    );
  }
  SearchRoot.displayName = displayName;

  return Object.assign(SearchRoot, {
    Input: SearchInput,
    Addon: SearchAddon,
    Loading: SearchLoading,
  });
}
