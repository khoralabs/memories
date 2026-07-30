import { describe, expect, test } from "bun:test";
import {
  fogBlurCssPx,
  fogChannelStrength,
  fogFactor,
  parseGraphSceneFogProp,
  resolveCssColor,
} from "./graph-scene-fog.js";

describe("parseGraphSceneFogProp", () => {
  test("disabled for undefined and false", () => {
    const off = parseGraphSceneFogProp(undefined);
    expect(off.active).toBe(false);
    expect(off.enabled).toBe(false);
    expect(off.color.enabled).toBe(false);
    expect(off.blur.enabled).toBe(false);
    expect(parseGraphSceneFogProp(false).active).toBe(false);
  });

  test("true enables color only with default ease", () => {
    const parsed = parseGraphSceneFogProp(true);
    expect(parsed.active).toBe(true);
    expect(parsed.enabled).toBe(true);
    expect(parsed.color).toMatchObject({
      enabled: true,
      ease: "smoothstep",
      amount: 1,
    });
    expect(parsed.blur.enabled).toBe(false);
    expect(parsed.needsFitDistance).toBe(true);
  });

  test("shared near/far/ease apply to enabled channels", () => {
    const parsed = parseGraphSceneFogProp({
      near: 2,
      far: 9,
      ease: "linear",
      blur: true,
    });
    expect(parsed.color).toMatchObject({
      enabled: true,
      near: 2,
      far: 9,
      ease: "linear",
      amount: 1,
    });
    expect(parsed.blur).toMatchObject({
      enabled: true,
      near: 2,
      far: 9,
      ease: "linear",
      amount: 4,
    });
    expect(parsed.needsFitDistance).toBe(false);
  });

  test("color and blur can use independent bounds and ease", () => {
    const colorEase = (t: number) => t * t;
    const parsed = parseGraphSceneFogProp({
      color: { near: 3, far: 10, ease: colorEase, strength: 0.6 },
      blur: { near: 5, far: 20, ease: "smootherstep", max: 8 },
    });
    expect(parsed.color).toEqual({
      enabled: true,
      near: 3,
      far: 10,
      ease: colorEase,
      amount: 0.6,
    });
    expect(parsed.blur).toEqual({
      enabled: true,
      near: 5,
      far: 20,
      ease: "smootherstep",
      amount: 8,
    });
  });

  test("color: false disables wash while blur can stay on", () => {
    const parsed = parseGraphSceneFogProp({
      color: false,
      blur: { max: 2 },
    });
    expect(parsed.active).toBe(true);
    expect(parsed.color.enabled).toBe(false);
    expect(parsed.blur.enabled).toBe(true);
    expect(parsed.blur.amount).toBe(2);
    expect(parsed.enabled).toBe(true);
    expect(parsed.needsFitDistance).toBe(true);
  });

  test("both channels false keeps fog active for stable chrome", () => {
    const parsed = parseGraphSceneFogProp({ color: false, blur: false });
    expect(parsed.active).toBe(true);
    expect(parsed.enabled).toBe(false);
    expect(parsed.color.enabled).toBe(false);
    expect(parsed.blur.enabled).toBe(false);
    expect(parsed.needsFitDistance).toBe(false);
  });

  test("channel options inherit shared defaults when partial", () => {
    const parsed = parseGraphSceneFogProp({
      near: 1,
      far: 8,
      color: { ease: "linear" },
      blur: { near: 4 },
    });
    expect(parsed.color).toMatchObject({ near: 1, far: 8, ease: "linear" });
    expect(parsed.blur).toMatchObject({ near: 4, far: 8, ease: "smoothstep" });
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
    const t = 0.25;
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

describe("fogChannelStrength", () => {
  test("is 0 below near and amount at/above far", () => {
    const channel = { near: 2, far: 10, ease: "linear" as const, amount: 0.8 };
    expect(fogChannelStrength(1, channel)).toBe(0);
    expect(fogChannelStrength(2, channel)).toBe(0);
    expect(fogChannelStrength(10, channel)).toBeCloseTo(0.8);
    expect(fogChannelStrength(12, channel)).toBeCloseTo(0.8);
  });

  test("scales mid-range factor by amount", () => {
    const channel = { near: 2, far: 10, ease: "linear" as const, amount: 0.5 };
    expect(fogChannelStrength(6, channel)).toBeCloseTo(0.25);
  });
});

describe("fogBlurCssPx", () => {
  test("scales CSS blur to counteract Html distanceFactor shrink", () => {
    const distanceFactor = 5;
    const amount = 4;
    // Mid fog at distance=10 → t=0.5 linear; css px = 0.5 * 4 * (10/5) = 4
    expect(fogBlurCssPx(10, 5, 15, amount, distanceFactor, "linear")).toBeCloseTo(4);
    // Same t-normalized mid at different distance would differ without compensation;
    // at far end t=1, distance=15 → css = 1 * 4 * (15/5) = 12 (screens as ~4px after scale)
    expect(fogBlurCssPx(15, 5, 15, amount, distanceFactor, "linear")).toBeCloseTo(12);
    expect(fogBlurCssPx(5, 5, 15, amount, distanceFactor, "linear")).toBeCloseTo(0);
  });

  test("on-screen blur (css * scale) tracks fog factor", () => {
    const distanceFactor = 5;
    const amount = 4;
    for (const distance of [5, 7.5, 10, 12.5, 15]) {
      const t = fogFactor(distance, 5, 15, "linear");
      const css = fogBlurCssPx(distance, 5, 15, amount, distanceFactor, "linear");
      const onScreen = css * (distanceFactor / distance);
      expect(onScreen).toBeCloseTo(t * amount);
    }
  });
});

describe("resolveCssColor", () => {
  test("returns non-var colors unchanged without touching the host", () => {
    const host = { appendChild() {}, removeChild() {} } as unknown as Element;
    expect(resolveCssColor("#fff", host)).toBe("#fff");
    expect(resolveCssColor("rgb(1, 2, 3)", host)).toBe("rgb(1, 2, 3)");
  });
});
