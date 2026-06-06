import { Focus } from "lucide-react";
import {
  createContext,
  type PropsWithChildren,
  type RefObject,
  useContext,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button.js";

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

/** Reframe-to-fit control when the camera has panned/zoomed; reads {@link useGraphCameraChrome}. */
export function GraphCameraReframeHint() {
  const { cameraViewDeviated, reframeRef } = useGraphCameraChrome();

  if (!cameraViewDeviated) return null;

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className="shrink-0 text-muted-foreground"
      title="Reframe graph"
      aria-label="Reframe graph to fit"
      onClick={() => reframeRef.current?.()}
    >
      <Focus className="size-4" />
    </Button>
  );
}
