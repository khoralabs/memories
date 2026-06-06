import { LoaderWithMessage } from "./components/loader-with-message.js";
import { useMemoriesGraphChrome } from "./use-projection.js";

/** Center loading chip while graph payload loads; reads {@link useMemoriesGraphChrome}. */
export function GraphLoading() {
  const { graphLoading, graphError } = useMemoriesGraphChrome();
  if (!graphLoading || graphError) return null;
  return <LoaderWithMessage>Loading…</LoaderWithMessage>;
}
