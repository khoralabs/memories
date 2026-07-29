import { describe, expect, test } from "bun:test";
import { fogFactor, parseGraphSceneFogProp, resolveCssColor } from "./graph-scene-fog.js";

describe("parseGraphSceneFogProp", () => {
  test("disabled for undefined and false", () => {
    expect(parseGraphSceneFogProp(undefined)).toEqual({ enabled: false, ease: "smoothstep" });
    expect(parseGraphSceneFogProp(false)).toEqual({ enabled: false, ease: "smoothstep" });
  });

  test("true enables with default ease", () => {
    expect(parseGraphSceneFogProp(true)).toEqual({ enabled: true, ease: "smoothstep" });
  });

  test("object passes through near, far, and ease", () => {
    const ease = (t: number) => t * t;
    expect(parseGraphSceneFogProp({ near: 2, far: 9, ease: "linear" })).toEqual({
      enabled: true,
      near: 2,
      far: 9,
      ease: "linear",
    });
    expect(parseGraphSceneFogProp({ ease })).toEqual({
      enabled: true,
      near: undefined,
      far: undefined,
      ease,
    });
  });

  test("object defaults ease to smoothstep", () => {
    expect(parseGraphSceneFogProp({ near: 1 })).toEqual({
      enabled: true,
      near: 1,
      far: undefined,
      ease: "smoothstep",
    });
  });
});

describe("fogFactor", () => {
  test("is 0 at/below near and 1 at/above far", () => {
    expect(fogFactor(1, 2, 10, "linear")).toBe(0);
    expect(fogFactor(2, 2, 10, "linear")).toBe(0);
    expect(fogFactor(10, 2, 10, "linear")).toBe(1);
    expect(fogFactor(12, 2, 10, "linear")).toBe(1);
  });

  test("linear interpolates across the range", () => {
    expect(fogFactor(6, 2, 10, "linear")).toBeCloseTo(0.5);
    expect(fogFactor(4, 2, 10, "linear")).toBeCloseTo(0.25);
  });

  test("smoothstep is the default and eases mid-range", () => {
    expect(fogFactor(6, 2, 10)).toBeCloseTo(0.5);
    expect(fogFactor(4, 2, 10, "smoothstep")).toBeCloseTo(0.15625);
    expect(fogFactor(4, 2, 10, "smoothstep")).toBeLessThan(fogFactor(4, 2, 10, "linear"));
    expect(fogFactor(4, 2, 10)).toBeCloseTo(fogFactor(4, 2, 10, "smoothstep"));
  });

  test("smootherstep is flatter near the ends than smoothstep", () => {
    const t = 0.25; // distance 4 in [2, 10]
    const smooth = fogFactor(4, 2, 10, "smoothstep");
    const smoother = fogFactor(4, 2, 10, "smootherstep");
    expect(smoother).toBeCloseTo(t * t * t * (t * (t * 6 - 15) + 10));
    expect(smoother).toBeLessThan(smooth);
  });

  test("custom ease maps normalized t", () => {
    expect(fogFactor(6, 2, 10, (t) => t * t)).toBeCloseTo(0.25);
    expect(fogFactor(2, 2, 10, () => 0.8)).toBeCloseTo(0.8);
  });

  test("clamps custom ease output to [0, 1]", () => {
    expect(fogFactor(6, 2, 10, () => 2)).toBe(1);
    expect(fogFactor(6, 2, 10, () => -1)).toBe(0);
  });

  test("degenerate far <= near is a step at far", () => {
    expect(fogFactor(4, 5, 5, "linear")).toBe(0);
    expect(fogFactor(5, 5, 5, "linear")).toBe(1);
    expect(fogFactor(3, 5, 4, "linear")).toBe(0);
    expect(fogFactor(4, 5, 4, "linear")).toBe(1);
  });
});

describe("resolveCssColor", () => {
  test("returns non-var colors unchanged without touching the host", () => {
    const host = { appendChild() {}, removeChild() {} } as unknown as Element;
    expect(resolveCssColor("#fff", host)).toBe("#fff");
    expect(resolveCssColor("rgb(1, 2, 3)", host)).toBe("rgb(1, 2, 3)");
  });
});
