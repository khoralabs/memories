import { Focus } from "lucide-react";
import {
  type ComponentProps,
  createContext,
  type PropsWithChildren,
  type ReactNode,
  type RefObject,
  useContext,
  useRef,
  useState,
} from "react";
import {
  type ChromeButtonTooltipProps,
  chromeButtonTooltipLabel,
  chromeButtonTooltipRootProps,
  partitionChromeButtonChildren,
} from "@/components/chrome-button-slots";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type GraphCameraChromeValue = {
  cameraViewDeviated: boolean;
  setCameraViewDeviated: (v: boolean) => void;
  reframeRef: RefObject<(() => void) | null>;
};

const GraphCameraChromeContext = createContext<GraphCameraChromeValue | null>(null);

export function GraphCameraChromeProvider({ children }: PropsWithChildren) {
  const reframeRef = useRef<(() => void) | null>(null);
  const [cameraViewDeviated, setCameraViewDeviated] = useState(false);

  const value: GraphCameraChromeValue = {
    cameraViewDeviated,
    setCameraViewDeviated,
    reframeRef,
  };

  return (
    <GraphCameraChromeContext.Provider value={value}>{children}</GraphCameraChromeContext.Provider>
  );
}

export function useGraphCameraChrome(): GraphCameraChromeValue {
  const ctx = useContext(GraphCameraChromeContext);
  if (!ctx) throw new Error("useGraphCameraChrome must be used within GraphCameraChromeProvider");
  return ctx;
}

const DEFAULT_TOOLTIP = "Reframe graph";

function GraphCameraReframeHintTooltip(_props: ChromeButtonTooltipProps) {
  return null;
}
GraphCameraReframeHintTooltip.displayName = "GraphCameraReframeHint.Tooltip";

export type GraphCameraReframeHintProps = Omit<ComponentProps<typeof Button>, "children"> & {
  children?: ReactNode;
};

/** Reframe-to-fit control when the camera has panned/zoomed; reads {@link useGraphCameraChrome}. */
function GraphCameraReframeHintRoot({
  className,
  children,
  onClick,
  type = "button",
  variant = "ghost",
  size = "icon-sm",
  "aria-label": ariaLabel = "Reframe graph to fit",
  ...props
}: GraphCameraReframeHintProps = {}) {
  const { cameraViewDeviated, reframeRef } = useGraphCameraChrome();
  const slots = partitionChromeButtonChildren(children, GraphCameraReframeHintTooltip);
  const tooltipLabel = chromeButtonTooltipLabel(slots.tooltip, DEFAULT_TOOLTIP);
  const tooltipRootProps = chromeButtonTooltipRootProps(slots.tooltip);
  const icon = slots.icon.length > 0 ? slots.icon : <Focus className="size-4" aria-hidden />;

  if (!cameraViewDeviated) return null;

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
            onClick={(e) => {
              onClick?.(e);
              reframeRef.current?.();
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

export const GraphCameraReframeHint = Object.assign(GraphCameraReframeHintRoot, {
  Tooltip: GraphCameraReframeHintTooltip,
});

export const GraphCameraChrome = Object.assign(GraphCameraChromeProvider, {
  ReframeHint: GraphCameraReframeHint,
});
