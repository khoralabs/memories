import { Window } from "happy-dom";

let windowRef: Window | null = null;

/** Install happy-dom `window` / `document` globals once for React provider tests. */
export function ensureDom(): void {
  if (windowRef !== null) return;
  const w = new Window({ url: "https://example.test/" });
  windowRef = w;
  // happy-dom types are not identical to lib.dom; cast through unknown for test globals.
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = w;
  g.document = w.document;
  g.navigator = w.navigator;
  g.Element = w.Element;
  g.HTMLElement = w.HTMLElement;
  g.Node = w.Node;
  g.DocumentFragment = w.DocumentFragment;
  g.MutationObserver = w.MutationObserver;
  g.getComputedStyle = w.getComputedStyle.bind(w);
  g.requestAnimationFrame = (cb: FrameRequestCallback) =>
    Number(w.setTimeout(() => cb(w.performance.now()), 0));
  g.cancelAnimationFrame = (id: number) => {
    w.clearTimeout(id as unknown as ReturnType<typeof w.setTimeout>);
  };
  if (w.document.body === null) {
    w.document.write("<!DOCTYPE html><html><body></body></html>");
  }
}
