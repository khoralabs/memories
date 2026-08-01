import type { ComponentProps, ReactNode } from "react";
import { LoaderWithMessage } from "./components/loader-with-message.js";
import { useMemoriesGraphChrome } from "./use-projection.js";

export type GraphLoadingProps = Omit<ComponentProps<typeof LoaderWithMessage>, "children"> & {
  children?: ReactNode;
};

/** Center loading chip while graph payload loads; reads {@link useMemoriesGraphChrome}. */
export function GraphLoading({ children = "Loading…", ...props }: GraphLoadingProps = {}) {
  const { graphLoading, graphError } = useMemoriesGraphChrome();
  if (!graphLoading || graphError) return null;
  return <LoaderWithMessage {...props}>{children}</LoaderWithMessage>;
}
