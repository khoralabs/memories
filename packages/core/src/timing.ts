/**
 * Monotonic-ish millisecond timestamp for duration marks.
 * Uses `performance.now()` in browsers / Node 16+; falls back to `Date.now()` where `performance` is missing (e.g. Convex isolates).
 */
export function nowMs(): number {
  const p = globalThis.performance;
  if (p && typeof p.now === "function") return p.now();
  return Date.now();
}

/** Elapsed milliseconds since the mark returned by {@link nowMs}. */
export function elapsedMs(start: number): number {
  return Math.round((nowMs() - start) * 100) / 100;
}
