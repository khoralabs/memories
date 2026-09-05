import { FilePlusIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import {
  type ChromeButtonTooltipProps,
  chromeButtonTooltipLabel,
  chromeButtonTooltipRootProps,
  partitionChromeButtonChildren,
} from "@/components/chrome-button-slots";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const DEFAULT_TOOLTIP = "New memory";

function AddMemoryButtonTooltip(_props: ChromeButtonTooltipProps) {
  return null;
}
AddMemoryButtonTooltip.displayName = "AddMemoryButton.Tooltip";

export type AddMemoryButtonProps = Omit<ComponentProps<typeof Button>, "children"> & {
  children?: ReactNode;
};

/**
 * Chrome trigger for creating a memory. Hosts wire `onClick` to open a form that
 * calls {@link useMemoriesMemory} `.create` (no built-in dialog).
 */
function AddMemoryButtonRoot({
  className,
  children,
  type = "button",
  variant = "ghost",
  size = "icon-sm",
  "aria-label": ariaLabel = DEFAULT_TOOLTIP,
  ...props
}: AddMemoryButtonProps) {
  const slots = partitionChromeButtonChildren(children, AddMemoryButtonTooltip);
  const tooltipLabel = chromeButtonTooltipLabel(slots.tooltip, DEFAULT_TOOLTIP);
  const tooltipRootProps = chromeButtonTooltipRootProps(slots.tooltip);
  const icon =
    slots.icon.length > 0 ? (
      slots.icon
    ) : (
      <FilePlusIcon className="text-muted-foreground" aria-hidden />
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
            className={cn("shrink-0 text-muted-foreground", className)}
          >
            {icon}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{tooltipLabel}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export const AddMemoryButton = Object.assign(AddMemoryButtonRoot, {
  Tooltip: AddMemoryButtonTooltip,
});
