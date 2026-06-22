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
import type { GraphInvestigatorClient } from "./graph-investigator-client.js";
import type { InvestigatorAnswer } from "./graph-investigator-types.js";
import { GraphOverlayContainer } from "./graph-overlay-container.js";
import type { GraphSearchState } from "./projection-types.js";
import { unifiedMarkdown } from "./unified-markdown.js";
import { useMemoriesGraphChrome, useProjection } from "./use-projection.js";

export type {
  InvestigatorAnswer,
  InvestigatorCitation,
} from "./graph-investigator-types.js";

export type GraphInvestigatorValue = {
  deepEnabled: boolean;
  setDeepEnabled: (v: boolean) => void;
  query: string;
  setQuery: (q: string) => void;
  loading: boolean;
  progressMessage: string | null;
  answer: InvestigatorAnswer | null;
  error: string | null;
  submit: () => void;
  reset: () => void;
};

export type GraphInvestigatorProviderProps = PropsWithChildren<{
  client: GraphInvestigatorClient;
}>;

const GraphInvestigatorContext = createContext<GraphInvestigatorValue | null>(null);

export function useGraphInvestigator(): GraphInvestigatorValue {
  const ctx = useContext(GraphInvestigatorContext);
  if (!ctx) {
    throw new Error("useGraphInvestigator must be used within GraphInvestigatorProvider");
  }
  return ctx;
}

function citationsToGraphSearchState(
  citations: readonly { memory_key: string; rationale?: string }[],
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

export function GraphInvestigatorProvider({ client, children }: GraphInvestigatorProviderProps) {
  const { namespace, setSearchQuery, setGraphSearchOverride } = useMemoriesGraphChrome();

  const [deepEnabled, setDeepEnabledState] = useState(false);
  const [query, setQueryState] = useState("");
  const [loading, setLoading] = useState(false);
  const [progressMessage, setProgressMessage] = useState<string | null>(null);
  const [answer, setAnswer] = useState<InvestigatorAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sessionRef = useRef<ReturnType<GraphInvestigatorClient["startInvestigation"]> | null>(null);

  const cancelActiveSession = useCallback(() => {
    sessionRef.current?.cancel();
    sessionRef.current = null;
  }, []);

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
        cancelActiveSession();
        setLoading(false);
        setProgressMessage(null);
        setAnswer(null);
        setError(null);
        setGraphSearchOverride(null);
        setSearchQuery(query);
      }
    },
    [cancelActiveSession, query, setGraphSearchOverride, setSearchQuery],
  );

  const reset = useCallback(() => {
    cancelActiveSession();
    setQueryState("");
    setLoading(false);
    setProgressMessage(null);
    setAnswer(null);
    setError(null);
    setGraphSearchOverride(null);
    if (!deepEnabled) setSearchQuery("");
  }, [cancelActiveSession, deepEnabled, setGraphSearchOverride, setSearchQuery]);

  const submit = useCallback(() => {
    const trimmed = query.trim();
    if (!trimmed) return;

    cancelActiveSession();
    setLoading(true);
    setProgressMessage(null);
    setError(null);
    setAnswer(null);
    setGraphSearchOverride(null);

    sessionRef.current = client.startInvestigation(
      { namespace, question: trimmed },
      {
        onProgress: (message) => {
          setProgressMessage(message);
        },
        onComplete: (payload) => {
          sessionRef.current = null;
          setAnswer({
            answer: payload.answer,
            ...(payload.citations !== undefined ? { citations: payload.citations } : {}),
            ...(payload.follow_up_queries !== undefined
              ? { follow_up_queries: payload.follow_up_queries }
              : {}),
          });
          if (payload.citations && payload.citations.length > 0) {
            setGraphSearchOverride(citationsToGraphSearchState(payload.citations));
          }
          setLoading(false);
          setProgressMessage(null);
        },
        onError: (message) => {
          sessionRef.current = null;
          setAnswer(null);
          setError(message);
          setLoading(false);
          setProgressMessage(null);
        },
      },
    );
  }, [cancelActiveSession, client, namespace, query, setGraphSearchOverride]);

  useEffect(() => {
    cancelActiveSession();
    setLoading(false);
    setProgressMessage(null);
    setAnswer(null);
    setError(null);
    setGraphSearchOverride(null);
  }, [cancelActiveSession, setGraphSearchOverride]);

  useEffect(
    () => () => {
      cancelActiveSession();
      setGraphSearchOverride(null);
    },
    [cancelActiveSession, setGraphSearchOverride],
  );

  const value = useMemo(
    (): GraphInvestigatorValue => ({
      deepEnabled,
      setDeepEnabled,
      query,
      setQuery,
      loading,
      progressMessage,
      answer,
      error,
      submit,
      reset,
    }),
    [
      deepEnabled,
      setDeepEnabled,
      query,
      setQuery,
      loading,
      progressMessage,
      answer,
      error,
      submit,
      reset,
    ],
  );

  return (
    <GraphInvestigatorContext.Provider value={value}>{children}</GraphInvestigatorContext.Provider>
  );
}

export function GraphInvestigatorAnswer() {
  const { loading, progressMessage, answer, error } = useGraphInvestigator();
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
    return <LoaderWithMessage>{progressMessage ?? "Investigating…"}</LoaderWithMessage>;
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

export function GraphInvestigatorAnswerOverlay({ className }: { className?: string }) {
  const { loading, answer, error } = useGraphInvestigator();
  if (!loading && !answer && !error) return null;
  return (
    <GraphOverlayContainer className={className}>
      <GraphInvestigatorAnswer />
    </GraphOverlayContainer>
  );
}
