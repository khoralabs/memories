import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { useMemoriesGraphChrome } from "./use-projection.js";

export type GraphFetchErrorProps = ComponentProps<"span">;

/** Graph fetch error line; reads {@link useMemoriesGraphChrome}. */
export function GraphFetchError({ className, children, ...props }: GraphFetchErrorProps = {}) {
  const { graphError, graphLoading, graphSummary } = useMemoriesGraphChrome();
  if (!graphError || graphLoading) return null;
  if (graphSummary.length > 0) return null;
  return (
    <span className={cn("text-sm text-destructive", className)} {...props}>
      {children ?? graphError}
    </span>
  );
}
