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
import { LoaderWithMessage } from "./components/loader-with-message.js";
import { GraphOverlayContainer } from "./graph-overlay-container.js";
import type { GraphSearchState } from "./projection-types.js";
import { unifiedMarkdown } from "./unified-markdown.js";
import { useMemoriesGraphChrome, useProjection } from "./use-projection.js";

const INVESTIGATE_PATH = "/investigate";

export type InvestigatorCitation = {
  memory_key: string;
  rationale?: string;
};

export type InvestigatorAnswer = {
  answer: string;
  citations?: InvestigatorCitation[];
  follow_up_queries?: string[];
};

export type GraphInvestigatorValue = {
  deepEnabled: boolean;
  setDeepEnabled: (v: boolean) => void;
  query: string;
  setQuery: (q: string) => void;
  loading: boolean;
  answer: InvestigatorAnswer | null;
  error: string | null;
  submit: () => void;
  reset: () => void;
};

const GraphInvestigatorContext = createContext<GraphInvestigatorValue | null>(null);

export function useGraphInvestigator(): GraphInvestigatorValue {
  const ctx = useContext(GraphInvestigatorContext);
  if (!ctx) {
    throw new Error("useGraphInvestigator must be used within GraphInvestigatorProvider");
  }
  return ctx;
}

/**
 * Deep-search state for the memory investigator. Must be a descendant of `GraphProjectionProvider`
 * so the live `namespace` from chrome drives the request target.
 */
function citationsToGraphSearchState(
  citations: readonly InvestigatorCitation[],
): GraphSearchState | null {
  const relevantKeys = new Set<string>();
  const hitSnippetByKey = new Map<string, string>();
  for (const c of citations) {
    const key = c.memory_key.trim();
    if (!key) continue;
    relevantKeys.add(key);
    const r = c.rationale?.trim();
    if (r && !hitSnippetByKey.has(key)) hitSnippetByKey.set(key, r);
  }
  if (relevantKeys.size === 0) return null;
  return {
    relevantKeys,
    hitCount: relevantKeys.size,
    hitSnippetByKey,
    hitSnippetByEdgeId: new Map(),
  };
}

export function GraphInvestigatorProvider({ children }: PropsWithChildren) {
  const { apiBase, namespace, setSearchQuery, setGraphSearchOverride } = useMemoriesGraphChrome();

  const [deepEnabled, setDeepEnabledState] = useState(false);
  const [query, setQueryState] = useState("");
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState<InvestigatorAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);

  const inFlightRef = useRef<AbortController | null>(null);

  const cancelInFlight = useCallback(() => {
    if (inFlightRef.current) {
      inFlightRef.current.abort();
      inFlightRef.current = null;
    }
  }, []);

  // Keep chrome's search-driven graph filter in sync with the input only while in graph mode.
  // In deep mode the typed query is for the investigator; the graph should not dim/filter.
  const setQuery = useCallback(
    (q: string) => {
      setQueryState(q);
      if (!deepEnabled) setSearchQuery(q);
    },
    [deepEnabled, setSearchQuery],
  );

  const setDeepEnabled = useCallback(
    (v: boolean) => {
      setDeepEnabledState(v);
      if (v) {
        setSearchQuery("");
      } else {
        cancelInFlight();
        setLoading(false);
        setAnswer(null);
        setError(null);
        setGraphSearchOverride(null);
        setSearchQuery(query);
      }
    },
    [cancelInFlight, query, setGraphSearchOverride, setSearchQuery],
  );

  const reset = useCallback(() => {
    cancelInFlight();
    setQueryState("");
    setLoading(false);
    setAnswer(null);
    setError(null);
    setGraphSearchOverride(null);
    if (!deepEnabled) setSearchQuery("");
  }, [cancelInFlight, deepEnabled, setGraphSearchOverride, setSearchQuery]);

  const submit = useCallback(() => {
    const trimmed = query.trim();
    if (!trimmed) return;
    cancelInFlight();
    const ac = new AbortController();
    inFlightRef.current = ac;
    setLoading(true);
    setError(null);
    setAnswer(null);
    setGraphSearchOverride(null);
    void (async () => {
      try {
        const res = await fetch(`${apiBase}${INVESTIGATE_PATH}`, {
          method: "POST",
          signal: ac.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ namespace, question: trimmed }),
        });
        const json = (await res.json()) as InvestigatorAnswer & { error?: string };
        if (ac.signal.aborted) return;
        if (!res.ok || json.error) {
          setAnswer(null);
          setError(json.error ?? res.statusText);
          return;
        }
        setAnswer({
          answer: json.answer,
          ...(json.citations !== undefined ? { citations: json.citations } : {}),
          ...(json.follow_up_queries !== undefined
            ? { follow_up_queries: json.follow_up_queries }
            : {}),
        });
        if (json.citations && json.citations.length > 0) {
          setGraphSearchOverride(citationsToGraphSearchState(json.citations));
        }
      } catch (e) {
        if (ac.signal.aborted) return;
        setError(String(e));
      } finally {
        if (inFlightRef.current === ac) inFlightRef.current = null;
        if (!ac.signal.aborted) setLoading(false);
      }
    })();
  }, [apiBase, cancelInFlight, namespace, query, setGraphSearchOverride]);

  // Drop stale state from a previous namespace; in-flight requests are aborted so their
  // resolution can't surface against the now-current namespace.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on namespace change
  useEffect(() => {
    cancelInFlight();
    setLoading(false);
    setAnswer(null);
    setError(null);
    setGraphSearchOverride(null);
  }, [cancelInFlight, namespace, setGraphSearchOverride]);

  useEffect(
    () => () => {
      cancelInFlight();
      setGraphSearchOverride(null);
    },
    [cancelInFlight, setGraphSearchOverride],
  );

  const value = useMemo(
    (): GraphInvestigatorValue => ({
      deepEnabled,
      setDeepEnabled,
      query,
      setQuery,
      loading,
      answer,
      error,
      submit,
      reset,
    }),
    [deepEnabled, setDeepEnabled, query, setQuery, loading, answer, error, submit, reset],
  );

  return (
    <GraphInvestigatorContext.Provider value={value}>{children}</GraphInvestigatorContext.Provider>
  );
}

/** Renders the investigator answer (or loading / error). Returns null when idle. */
export function GraphInvestigatorAnswer() {
  const { loading, answer, error } = useGraphInvestigator();
  const { points, setSelected } = useProjection();

  const pointByKey = useMemo(() => {
    const m = new Map<string, (typeof points)[number]>();
    for (const p of points) m.set(p.entryId, p);
    return m;
  }, [points]);

  const answerMarkdown = useMemo(() => {
    if (!answer) return null;
    try {
      return unifiedMarkdown.processSync(answer.answer).result;
    } catch {
      return <p className="text-sm leading-relaxed whitespace-pre-wrap">{answer.answer}</p>;
    }
  }, [answer]);

  if (loading) {
    return <LoaderWithMessage>Investigating…</LoaderWithMessage>;
  }
  if (error) {
    return <div className="text-sm text-destructive whitespace-pre-wrap">{error}</div>;
  }
  if (!answer) return null;

  return (
    <div className="flex flex-col gap-3 text-sm">
      {answerMarkdown}
      {answer.citations && answer.citations.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-muted-foreground">Citations</span>
          <ul className="flex flex-col gap-2">
            {answer.citations.map((c) => {
              const point = pointByKey.get(c.memory_key);
              const code = (
                <code className="rounded bg-muted px-1 py-0.5 text-foreground">{c.memory_key}</code>
              );
              return (
                <li key={c.memory_key} className="text-xs text-muted-foreground">
                  {point ? (
                    <button
                      type="button"
                      onClick={() => setSelected(point)}
                      className="cursor-pointer rounded text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label={`Pin memory ${c.memory_key}`}
                    >
                      {code}
                    </button>
                  ) : (
                    code
                  )}
                  {c.rationale ? <span className="ml-2">{c.rationale}</span> : null}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {answer.follow_up_queries && answer.follow_up_queries.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-muted-foreground">Follow-up queries</span>
          <ul className="list-disc pl-5">
            {answer.follow_up_queries.map((q) => (
              <li key={q} className="text-xs text-muted-foreground">
                {q}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Floating overlay shell for {@link GraphInvestigatorAnswer}. Renders nothing when there is no
 * loading / answer / error so the scene stays uncluttered.
 */
export function GraphInvestigatorAnswerOverlay({ className }: { className?: string }) {
  const { loading, answer, error } = useGraphInvestigator();
  if (!loading && !answer && !error) return null;
  return (
    <GraphOverlayContainer className={className}>
      <GraphInvestigatorAnswer />
    </GraphOverlayContainer>
  );
}
