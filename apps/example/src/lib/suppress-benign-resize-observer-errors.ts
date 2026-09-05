export function isBenignResizeObserverError(event: ErrorEvent | Event): boolean {
  const fromMessage =
    typeof (event as ErrorEvent).message === "string" &&
    (event as ErrorEvent).message.toLowerCase().includes("resizeobserver");
  if (fromMessage) return true;
  const err = (event as ErrorEvent).error;
  return err instanceof Error && err.message.toLowerCase().includes("resizeobserver");
}

function onWindowError(e: ErrorEvent): void {
  if (isBenignResizeObserverError(e)) {
    e.stopImmediatePropagation();
    e.preventDefault();
  }
}

function onUnhandledRejection(e: PromiseRejectionEvent): void {
  const reason = e.reason;
  const msg = typeof reason === "string" ? reason : reason instanceof Error ? reason.message : "";
  if (msg.toLowerCase().includes("resizeobserver")) {
    e.preventDefault();
    e.stopPropagation();
  }
}

let refCount = 0;

/** Install global listeners; returns cleanup. Safe to call multiple times (ref-counted). */
export function installBenignResizeObserverErrorSuppression(): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }
  refCount += 1;
  if (refCount === 1) {
    window.addEventListener("error", onWindowError, true);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
  }
  return () => {
    refCount = Math.max(0, refCount - 1);
    if (refCount === 0) {
      window.removeEventListener("error", onWindowError, true);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    }
  };
}
