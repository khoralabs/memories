import { FolderPlusIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  type ChromeButtonTooltipProps,
  chromeButtonTooltipLabel,
  chromeButtonTooltipRootProps,
  partitionChromeButtonChildren,
} from "./lib/chrome-button-slots.js";

const DEFAULT_TOOLTIP = "New namespace";

function AddNamespaceButtonTooltip(_props: ChromeButtonTooltipProps) {
  return null;
}
AddNamespaceButtonTooltip.displayName = "AddNamespaceButton.Tooltip";

export type AddNamespaceButtonProps = Omit<ComponentProps<typeof Button>, "children"> & {
  children?: ReactNode;
};

/**
 * Chrome trigger for creating a namespace. Hosts wire `onClick` to open a form that
 * calls {@link useMemoriesNamespaces} `.create` (no built-in dialog).
 */
function AddNamespaceButtonRoot({
  className,
  children,
  type = "button",
  variant = "ghost",
  size = "icon-sm",
  "aria-label": ariaLabel = DEFAULT_TOOLTIP,
  ...props
}: AddNamespaceButtonProps) {
  const slots = partitionChromeButtonChildren(children, AddNamespaceButtonTooltip);
  const tooltipLabel = chromeButtonTooltipLabel(slots.tooltip, DEFAULT_TOOLTIP);
  const tooltipRootProps = chromeButtonTooltipRootProps(slots.tooltip);
  const icon =
    slots.icon.length > 0 ? (
      slots.icon
    ) : (
      <FolderPlusIcon className="text-muted-foreground" aria-hidden />
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

export const AddNamespaceButton = Object.assign(AddNamespaceButtonRoot, {
  Tooltip: AddNamespaceButtonTooltip,
  namespaceTreeLabelAction: true as const,
});
