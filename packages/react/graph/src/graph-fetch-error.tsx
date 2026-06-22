import { useMemoriesGraphChrome } from "./use-projection.js";

/** Graph fetch error line; reads {@link useMemoriesGraphChrome}. */
export function GraphFetchError() {
  const { graphError, graphLoading, graphSummary } = useMemoriesGraphChrome();
  if (!graphError || graphLoading) return null;
  if (graphSummary.length > 0) return null;
  return <span className="text-sm text-destructive">{graphError}</span>;
}
