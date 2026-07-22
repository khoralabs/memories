/** High-resolution elapsed milliseconds since `performance.now()` mark `start`. */
export function elapsedMs(start: number): number {
  return Math.round((performance.now() - start) * 100) / 100;
}
