import { RefreshCcwIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import {
  type ChromeButtonTooltipProps,
  chromeButtonTooltipLabel,
  chromeButtonTooltipRootProps,
  partitionChromeButtonChildren,
} from "@/components/chrome-button-slots";
import { useMemoriesGraphChrome } from "@/components/memories/use-projection";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const DEFAULT_TOOLTIP = "Refresh graph";

function RefreshGraphButtonTooltip(_props: ChromeButtonTooltipProps) {
  return null;
}
RefreshGraphButtonTooltip.displayName = "RefreshGraphButton.Tooltip";

export type RefreshGraphButtonProps = Omit<ComponentProps<typeof Button>, "children"> & {
  children?: ReactNode;
};

/** Refresh graph data + namespace catalog; reads {@link useMemoriesGraphChrome}. */
function RefreshGraphButtonRoot({
  className,
  children,
  onClick,
  type = "button",
  variant = "ghost",
  size = "icon-sm",
  "aria-label": ariaLabel = DEFAULT_TOOLTIP,
  disabled,
  ...props
}: RefreshGraphButtonProps = {}) {
  const { refreshAll, graphLoading } = useMemoriesGraphChrome();
  const slots = partitionChromeButtonChildren(children, RefreshGraphButtonTooltip);
  const tooltipLabel = chromeButtonTooltipLabel(slots.tooltip, DEFAULT_TOOLTIP);
  const tooltipRootProps = chromeButtonTooltipRootProps(slots.tooltip);
  const icon =
    slots.icon.length > 0 ? (
      slots.icon
    ) : (
      <RefreshCcwIcon className="text-muted-foreground" aria-hidden />
    );

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
            disabled={disabled ?? graphLoading}
            className={cn("shrink-0 text-muted-foreground", className)}
            onClick={(e) => {
              onClick?.(e);
              if (!e.defaultPrevented) void refreshAll();
            }}
          >
            {icon}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{tooltipLabel}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export const RefreshGraphButton = Object.assign(RefreshGraphButtonRoot, {
  Tooltip: RefreshGraphButtonTooltip,
  namespaceTreeLabelAction: true as const,
});
