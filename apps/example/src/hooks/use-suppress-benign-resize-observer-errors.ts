import { useEffect } from "react";

import { installBenignResizeObserverErrorSuppression } from "@/lib/suppress-benign-resize-observer-errors";

/** Suppress benign ResizeObserver loop errors from R3F + overlay reflow. */
export function useSuppressBenignResizeObserverErrors(): void {
  useEffect(() => installBenignResizeObserverErrorSuppression(), []);
}
