import { BrainIcon, ScanSearchIcon, SendIcon } from "lucide-react";
import type * as React from "react";
import type { ComponentProps } from "react";
import { useEffect } from "react";
import TextareaAutosize from "react-textarea-autosize";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group.js";
import { Spinner } from "@/components/ui/spinner.js";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./components/ui/tooltip.js";
import { useGraphInvestigator } from "./graph-investigator.js";
import type { GraphSearchState } from "./projection-types.js";
import { useMemoriesGraphChrome } from "./use-projection.js";

export function graphSearchSummaryLine(
  queryTrimmed: string,
  graphSearch: GraphSearchState | null,
): string {
  if (queryTrimmed.length === 0) return "";
  return graphSearch
    ? `${graphSearch.hitCount} hit${graphSearch.hitCount === 1 ? "" : "s"} · ${graphSearch.relevantKeys.size} in subgraph`
    : "…";
}

type GraphSearchRegularProps = {
  query: string;
  setQuery: (q: string) => void;
  summary: string;
  searchLoading: boolean;
  /** When false, the deep-search toggle is not shown. */
  deepSearch: boolean;
  onToggleDeep: () => void;
  className?: string;
  inputProps?: ComponentProps<typeof InputGroupInput>;
  deepToggleButtonProps?: ComponentProps<typeof InputGroupButton>;
};

function GraphSearchRegular({
  query,
  setQuery,
  summary,
  searchLoading,
  deepSearch,
  onToggleDeep,
  className,
  inputProps,
  deepToggleButtonProps,
}: GraphSearchRegularProps) {
  const {
    className: inputClassName,
    onChange: inputOnChange,
    value: _inputValue,
    ...restInputProps
  } = inputProps ?? {};
  const {
    className: deepToggleClassName,
    onClick: deepToggleOnClick,
    children: deepToggleChildren,
    size: deepToggleSize = "icon-xs",
    ...restDeepToggleProps
  } = deepToggleButtonProps ?? {};

  return (
    <InputGroup className={cn("w-full", className)}>
      <InputGroupInput
        placeholder="Search…"
        aria-label="Search memories"
        {...restInputProps}
        value={query}
        onChange={(e) => {
          inputOnChange?.(e);
          setQuery(e.target.value);
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
      {deepSearch ? (
        <InputGroupAddon align="inline-end">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <InputGroupButton
                  size={deepToggleSize}
                  aria-pressed={false}
                  aria-label="Enable deep search"
                  {...restDeepToggleProps}
                  className={deepToggleClassName}
                  onClick={(e) => {
                    deepToggleOnClick?.(e);
                    onToggleDeep();
                  }}
                >
                  {deepToggleChildren ?? <BrainIcon aria-hidden />}
                </InputGroupButton>
              </TooltipTrigger>
              <TooltipContent side="right">Enable deep search</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </InputGroupAddon>
      ) : null}
    </InputGroup>
  );
}

type GraphSearchDeepProps = {
  query: string;
  setQuery: (q: string) => void;
  canSend: boolean;
  investigating: boolean;
  onSubmit: () => void;
  onLeaveDeep: () => void;
  className?: string;
  submitButtonProps?: ComponentProps<typeof InputGroupButton>;
  leaveDeepButtonProps?: ComponentProps<typeof InputGroupButton>;
};

function GraphSearchDeep({
  query,
  setQuery,
  canSend,
  investigating,
  onSubmit,
  onLeaveDeep,
  className,
  submitButtonProps,
  leaveDeepButtonProps,
}: GraphSearchDeepProps) {
  const {
    className: leaveClassName,
    onClick: leaveOnClick,
    children: leaveChildren,
    size: leaveSize = "icon-sm",
    variant: leaveVariant = "ghost",
    ...restLeaveProps
  } = leaveDeepButtonProps ?? {};
  const {
    className: submitClassName,
    onClick: submitOnClick,
    children: submitChildren,
    size: submitSize = "icon-sm",
    variant: submitVariant = "outline",
    disabled: submitDisabled,
    ...restSubmitProps
  } = submitButtonProps ?? {};

  return (
    <InputGroup className={cn("w-full", className)}>
      <TextareaAutosize
        data-slot="input-group-control"
        minRows={3}
        placeholder="Ask a question…"
        value={query}
        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setQuery(e.target.value)}
        onKeyDown={(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (canSend) onSubmit();
          }
        }}
        aria-label="Ask the memory investigator"
        className={cn(
          "flex field-sizing-content min-h-16 w-full resize-none rounded-none border-0 bg-transparent px-3 py-2.5 text-base shadow-none transition-[color,box-shadow] outline-none md:text-sm",
          "focus-visible:ring-0 dark:bg-transparent",
        )}
      />
      <InputGroupAddon align="block-start" className="border-b">
        <InputGroupText className="font-mono text-xs font-medium">
          <BrainIcon className="text-muted-foreground" aria-hidden />
          Deep search
        </InputGroupText>
      </InputGroupAddon>
      <InputGroupAddon align="block-end" className="w-full flex justify-between">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <InputGroupButton
                size={leaveSize}
                variant={leaveVariant}
                aria-pressed
                aria-label="Disable deep search"
                {...restLeaveProps}
                className={cn("text-foreground shrink-0", leaveClassName)}
                onClick={(e) => {
                  leaveOnClick?.(e);
                  onLeaveDeep();
                }}
              >
                {leaveChildren ?? <ScanSearchIcon className="text-muted-foreground" aria-hidden />}
              </InputGroupButton>
            </TooltipTrigger>
            <TooltipContent side="right">Disable deep search</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <InputGroupButton
          size={submitSize}
          variant={submitVariant}
          {...restSubmitProps}
          className={cn("ml-auto", submitClassName)}
          onClick={(e) => {
            submitOnClick?.(e);
            onSubmit();
          }}
          disabled={submitDisabled ?? !canSend}
        >
          {submitChildren ??
            (investigating ? (
              <Spinner className="size-4" aria-label="Investigating" />
            ) : (
              <SendIcon />
            ))}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  );
}

export type GraphSearchProps = {
  /**
   * When false, the deep-search entry control is hidden and deep mode cannot be shown.
   * Default true.
   */
  deepSearch?: boolean;
  className?: string;
  inputProps?: ComponentProps<typeof InputGroupInput>;
  deepToggleButtonProps?: ComponentProps<typeof InputGroupButton>;
  submitButtonProps?: ComponentProps<typeof InputGroupButton>;
  leaveDeepButtonProps?: ComponentProps<typeof InputGroupButton>;
};

/**
 * Search row; reads {@link useMemoriesGraphChrome} for graph-search state and
 * {@link useGraphInvestigator} for deep-search state — must be under both
 * {@link GraphProjectionProvider} and `GraphInvestigatorProvider`.
 */
export function GraphSearch({
  deepSearch = true,
  className,
  inputProps,
  deepToggleButtonProps,
  submitButtonProps,
  leaveDeepButtonProps,
}: GraphSearchProps = {}) {
  const { graphSearch, searchLoading } = useMemoriesGraphChrome();
  const {
    deepEnabled,
    setDeepEnabled,
    query,
    setQuery,
    submit,
    loading: investigating,
  } = useGraphInvestigator();
  const summary = graphSearchSummaryLine(query.trim(), graphSearch);
  const canSend = !investigating && query.trim().length > 0;

  useEffect(() => {
    if (!deepSearch && deepEnabled) setDeepEnabled(false);
  }, [deepSearch, deepEnabled, setDeepEnabled]);

  if (deepSearch && deepEnabled) {
    return (
      <GraphSearchDeep
        query={query}
        setQuery={setQuery}
        canSend={canSend}
        investigating={investigating}
        onSubmit={submit}
        onLeaveDeep={() => setDeepEnabled(false)}
        className={className}
        submitButtonProps={submitButtonProps}
        leaveDeepButtonProps={leaveDeepButtonProps}
      />
    );
  }

  return (
    <GraphSearchRegular
      query={query}
      setQuery={setQuery}
      summary={summary}
      searchLoading={searchLoading}
      deepSearch={deepSearch}
      onToggleDeep={() => setDeepEnabled(true)}
      className={className}
      inputProps={inputProps}
      deepToggleButtonProps={deepToggleButtonProps}
    />
  );
}
