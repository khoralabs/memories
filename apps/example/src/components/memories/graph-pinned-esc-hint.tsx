import type { ComponentProps, ReactNode } from "react";
import {
  type ChromeButtonTooltipProps,
  chromeButtonTooltipLabel,
  chromeButtonTooltipRootProps,
  partitionChromeButtonChildren,
} from "@/components/chrome-button-slots";
import { useMemoriesGraphChrome } from "@/components/memories/use-projection";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const DEFAULT_TOOLTIP = "Clear edge focus";

function GraphPinnedEscHintTooltip(_props: ChromeButtonTooltipProps) {
  return null;
}
GraphPinnedEscHintTooltip.displayName = "GraphPinnedEscHint.Tooltip";

export type GraphPinnedEscHintProps = Omit<ComponentProps<typeof Button>, "children"> & {
  children?: ReactNode;
};

/** Shown when pin/search drives the subgraph; reads {@link useMemoriesGraphChrome}. */
function GraphPinnedEscHintRoot({
  className,
  children,
  onClick,
  type = "button",
  variant = "ghost",
  size = "sm",
  "aria-label": ariaLabel = DEFAULT_TOOLTIP,
  ...props
}: GraphPinnedEscHintProps = {}) {
  const { hasGraphSubgraphStrongFocus, dismissPersistentGraphFocus } = useMemoriesGraphChrome();
  const slots = partitionChromeButtonChildren(children, GraphPinnedEscHintTooltip);
  const tooltipLabel = chromeButtonTooltipLabel(slots.tooltip, DEFAULT_TOOLTIP);
  const tooltipRootProps = chromeButtonTooltipRootProps(slots.tooltip);
  const content =
    slots.icon.length > 0 ? (
      slots.icon
    ) : (
      <>
        <span className="text-xs text-muted-foreground font-normal">esc to clear edges</span>
        <Kbd className="text-[10px]">Esc</Kbd>
      </>
    );

  if (!hasGraphSubgraphStrongFocus) return null;

  return (
    <TooltipProvider>
      <Tooltip {...tooltipRootProps}>
        <TooltipTrigger asChild>
          <Button
            type={type}
            variant={variant}
            size={size}
            aria-label={ariaLabel}
            {...props}
            className={cn("flex shrink-0 items-center gap-2", className)}
            onClick={(e) => {
              onClick?.(e);
              dismissPersistentGraphFocus();
            }}
          >
            {content}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{tooltipLabel}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export const GraphPinnedEscHint = Object.assign(GraphPinnedEscHintRoot, {
  Tooltip: GraphPinnedEscHintTooltip,
});
