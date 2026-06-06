import { useMemoriesGraphChrome } from "./use-projection.js";

/** Graph fetch error line; reads {@link useMemoriesGraphChrome}. */
export function GraphFetchError() {
  const { graphError } = useMemoriesGraphChrome();
  if (!graphError) return null;
  return <span className="text-sm text-destructive">{graphError}</span>;
}
