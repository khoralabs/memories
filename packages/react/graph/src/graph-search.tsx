import { BrainIcon, ScanSearchIcon, SendIcon } from "lucide-react";
import type * as React from "react";
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
};

function GraphSearchRegular({
  query,
  setQuery,
  summary,
  searchLoading,
  deepSearch,
  onToggleDeep,
}: GraphSearchRegularProps) {
  return (
    <InputGroup className="w-full">
      <InputGroupInput
        placeholder="Search…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search memories"
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
                  size="icon-xs"
                  onClick={onToggleDeep}
                  aria-pressed={false}
                  aria-label="Enable deep search"
                >
                  <BrainIcon aria-hidden />
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
};

function GraphSearchDeep({
  query,
  setQuery,
  canSend,
  investigating,
  onSubmit,
  onLeaveDeep,
}: GraphSearchDeepProps) {
  return (
    <InputGroup className="w-full">
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
                size="icon-sm"
                variant="ghost"
                onClick={onLeaveDeep}
                aria-pressed
                aria-label="Disable deep search"
                className="text-foreground shrink-0"
              >
                <ScanSearchIcon className="text-muted-foreground" aria-hidden />
              </InputGroupButton>
            </TooltipTrigger>
            <TooltipContent side="right">Disable deep search</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <InputGroupButton
          size="icon-sm"
          variant="outline"
          className="ml-auto"
          onClick={() => onSubmit()}
          disabled={!canSend}
        >
          {investigating ? <Spinner className="size-4" aria-label="Investigating" /> : <SendIcon />}
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
};

/**
 * Search row; reads {@link useMemoriesGraphChrome} for graph-search state and
 * {@link useGraphInvestigator} for deep-search state — must be under both
 * {@link GraphProjectionProvider} and `GraphInvestigatorProvider`.
 */
export function GraphSearch({ deepSearch = true }: GraphSearchProps = {}) {
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
    />
  );
}
