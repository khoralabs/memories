import type { ComponentProps, ReactNode } from "react";
import { LoaderWithMessage } from "@/components/memories/loader-with-message";
import { useMemoriesGraphChrome } from "@/components/memories/use-projection";

export type GraphLoadingProps = Omit<ComponentProps<typeof LoaderWithMessage>, "children"> & {
  children?: ReactNode;
};

/** Center loading chip while graph payload loads; reads {@link useMemoriesGraphChrome}. */
export function GraphLoading({ children = "Loading…", ...props }: GraphLoadingProps = {}) {
  const { graphLoading, graphError } = useMemoriesGraphChrome();
  if (!graphLoading || graphError) return null;
  return <LoaderWithMessage {...props}>{children}</LoaderWithMessage>;
}
