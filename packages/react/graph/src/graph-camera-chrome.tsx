import { Focus } from "lucide-react";
import {
  type ComponentProps,
  createContext,
  type PropsWithChildren,
  type RefObject,
  useContext,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button.js";
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

export type GraphCameraReframeHintProps = ComponentProps<typeof Button>;

/** Reframe-to-fit control when the camera has panned/zoomed; reads {@link useGraphCameraChrome}. */
export function GraphCameraReframeHint({
  className,
  children,
  onClick,
  type = "button",
  variant = "ghost",
  size = "icon-sm",
  title = "Reframe graph",
  "aria-label": ariaLabel = "Reframe graph to fit",
  ...props
}: GraphCameraReframeHintProps = {}) {
  const { cameraViewDeviated, reframeRef } = useGraphCameraChrome();

  if (!cameraViewDeviated) return null;

  return (
    <Button
      type={type}
      variant={variant}
      size={size}
      title={title}
      aria-label={ariaLabel}
      {...props}
      className={cn("shrink-0 text-muted-foreground", className)}
      onClick={(e) => {
        onClick?.(e);
        reframeRef.current?.();
      }}
    >
      {children ?? <Focus className="size-4" />}
    </Button>
  );
}

export const GraphCameraChrome = Object.assign(GraphCameraChromeProvider, {
  ReframeHint: GraphCameraReframeHint,
});
