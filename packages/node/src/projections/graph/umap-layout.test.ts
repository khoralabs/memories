import { describe, expect, test } from "bun:test";
import { fibonacciSphereLayout3D, umap3DLayout } from "./umap-layout";

describe("umap3DLayout", () => {
  test("returns deterministic normalized positions", () => {
    const points = umap3DLayout(
      [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
        [1, 1, 0],
      ],
      { seed: 123 },
    );
    expect(points).toHaveLength(4);
    for (const point of points) {
      expect(point.x).toBeGreaterThanOrEqual(-1);
      expect(point.x).toBeLessThanOrEqual(1);
      expect(point.y).toBeGreaterThanOrEqual(-1);
      expect(point.y).toBeLessThanOrEqual(1);
      expect(point.z).toBeGreaterThanOrEqual(-1);
      expect(point.z).toBeLessThanOrEqual(1);
    }
  });

  test("uses fibonacci fallback for small inputs", () => {
    expect(fibonacciSphereLayout3D(2)).toHaveLength(2);
    expect(umap3DLayout([[1], [2]])).toHaveLength(2);
  });
});
