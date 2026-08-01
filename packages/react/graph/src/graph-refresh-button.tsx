import { RefreshCcwIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { InputGroupButton } from "@/components/ui/input-group.js";
import { cn } from "@/lib/utils";
import { useMemoriesGraphChrome } from "./use-projection.js";

export type GraphRefreshButtonProps = ComponentProps<typeof InputGroupButton>;

/** Refresh graph data; reads {@link useMemoriesGraphChrome}. */
export function GraphRefreshButton({
  className,
  children,
  onClick,
  type = "button",
  variant = "ghost",
  size = "icon-sm",
  title = "Refresh graph",
  "aria-label": ariaLabel = "Refresh graph",
  disabled,
  ...props
}: GraphRefreshButtonProps = {}) {
  const { refreshAll, graphLoading } = useMemoriesGraphChrome();
  return (
    <InputGroupButton
      type={type}
      variant={variant}
      size={size}
      title={title}
      aria-label={ariaLabel}
      {...props}
      disabled={disabled ?? graphLoading}
      className={cn("shrink-0 text-muted-foreground", className)}
      onClick={(e) => {
        onClick?.(e);
        void refreshAll();
      }}
    >
      {children ?? <RefreshCcwIcon className="text-muted-foreground" aria-hidden />}
    </InputGroupButton>
  );
}
