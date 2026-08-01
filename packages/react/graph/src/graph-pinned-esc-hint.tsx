import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button.js";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";
import { useMemoriesGraphChrome } from "./use-projection.js";

export type GraphPinnedEscHintProps = ComponentProps<typeof Button>;

/** Shown when pin/search drives the subgraph; reads {@link useMemoriesGraphChrome}. */
export function GraphPinnedEscHint({
  className,
  children,
  onClick,
  type = "button",
  variant = "ghost",
  size = "sm",
  ...props
}: GraphPinnedEscHintProps = {}) {
  const { hasGraphSubgraphStrongFocus, dismissPersistentGraphFocus } = useMemoriesGraphChrome();
  if (!hasGraphSubgraphStrongFocus) return null;

  return (
    <Button
      type={type}
      variant={variant}
      size={size}
      {...props}
      className={cn("flex shrink-0 items-center gap-2", className)}
      onClick={(e) => {
        onClick?.(e);
        dismissPersistentGraphFocus();
      }}
    >
      {children ?? (
        <>
          <span className="text-xs text-muted-foreground font-normal">esc to clear edges</span>
          <Kbd className="text-[10px]">Esc</Kbd>
        </>
      )}
    </Button>
  );
}
