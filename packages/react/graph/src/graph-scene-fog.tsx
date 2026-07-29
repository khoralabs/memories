import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { MathUtils } from "three";

/**
 * Maps normalized depth `t` in `[0, 1]` (near→far) to veil strength in `[0, 1]`.
 * Named presets or a custom function.
 */
export type GraphSceneFogEase = "linear" | "smoothstep" | "smootherstep" | ((t: number) => number);

export type GraphSceneFogOptions = {
  /** World-space distance where fog starts (factor 0). */
  near?: number;
  /** World-space distance where fog is full (factor 1 before ease). */
  far?: number;
  /**
   * How veil strength rises over `[near, far]`. Default `"smoothstep"`.
   * Custom `(t) => number` receives normalized depth `0..1` and should return strength `0..1`.
   */
  ease?: GraphSceneFogEase;
};

/** Opt-in depth fog: `true` uses auto near/far from camera fit; object overrides ranges. */
export type GraphSceneFogProp = boolean | GraphSceneFogOptions;

export type GraphSceneFogValue = {
  enabled: boolean;
  near: number;
  far: number;
  ease: GraphSceneFogEase;
  /** Resolved CSS color used for the wash veil (matches scene clear color). */
  background: string;
  /** Update auto near/far from the last camera-fit distance `d`. */
  setFitDistance: (d: number) => void;
};

const GraphSceneFogContext = createContext<GraphSceneFogValue | null>(null);

const AUTO_NEAR_FACTOR = 0.9;
const AUTO_FAR_FACTOR = 2.2;
/** Used before the first camera fit when fog is on without explicit near/far. */
const FALLBACK_NEAR = 4;
const FALLBACK_FAR = 12;
const DEFAULT_EASE: GraphSceneFogEase = "smoothstep";

function applyFogEase(t: number, ease: GraphSceneFogEase): number {
  const x = MathUtils.clamp(t, 0, 1);
  if (typeof ease === "function") return MathUtils.clamp(ease(x), 0, 1);
  switch (ease) {
    case "linear":
      return x;
    case "smootherstep":
      // Ken Perlin’s smootherstep
      return x * x * x * (x * (x * 6 - 15) + 10);
    case "smoothstep":
      return x * x * (3 - 2 * x);
  }
}

/** Normalized depth then eased veil strength in `[0, 1]`. */
export function fogFactor(
  distance: number,
  near: number,
  far: number,
  ease: GraphSceneFogEase = DEFAULT_EASE,
): number {
  const t = !(far > near)
    ? distance >= far
      ? 1
      : 0
    : MathUtils.clamp((distance - near) / (far - near), 0, 1);
  return applyFogEase(t, ease);
}

export function parseGraphSceneFogProp(fog: GraphSceneFogProp | undefined): {
  enabled: boolean;
  near?: number;
  far?: number;
  ease: GraphSceneFogEase;
} {
  if (fog == null || fog === false) return { enabled: false, ease: DEFAULT_EASE };
  if (fog === true) return { enabled: true, ease: DEFAULT_EASE };
  return {
    enabled: true,
    near: fog.near,
    far: fog.far,
    ease: fog.ease ?? DEFAULT_EASE,
  };
}

/** Resolve CSS colors (including `var(...)`) to a concrete `rgb(...)` for the veil. */
export function resolveCssColor(color: string, host: Element): string {
  if (!color.includes("var(")) return color;
  const probe = document.createElement("div");
  probe.style.cssText = "position:absolute;width:0;height:0;visibility:hidden;pointer-events:none";
  probe.style.backgroundColor = color;
  host.appendChild(probe);
  const resolved = getComputedStyle(probe).backgroundColor;
  host.removeChild(probe);
  return resolved && resolved !== "rgba(0, 0, 0, 0)" && resolved !== "transparent"
    ? resolved
    : color;
}

type GraphSceneFogProviderProps = {
  fog: GraphSceneFogProp | undefined;
  background: string;
  /** Element used to resolve CSS variables (canvas host). */
  colorHost: Element | null;
  children: ReactNode;
};

export function GraphSceneFogProvider({
  fog,
  background,
  colorHost,
  children,
}: GraphSceneFogProviderProps) {
  const parsed = parseGraphSceneFogProp(fog);
  const [fitDistance, setFitDistanceState] = useState<number | null>(null);

  const setFitDistance = useCallback(
    (d: number) => {
      if (!parsed.enabled) return;
      if (parsed.near != null && parsed.far != null) return;
      setFitDistanceState((prev) => (prev != null && Math.abs(prev - d) < 1e-4 ? prev : d));
    },
    [parsed.enabled, parsed.near, parsed.far],
  );

  const resolvedBackground = useMemo(() => {
    if (!parsed.enabled) return background;
    if (typeof document === "undefined") return background;
    const host = colorHost ?? document.body;
    return resolveCssColor(background, host);
  }, [parsed.enabled, background, colorHost]);

  const value = useMemo((): GraphSceneFogValue => {
    if (!parsed.enabled) {
      return {
        enabled: false,
        near: FALLBACK_NEAR,
        far: FALLBACK_FAR,
        ease: parsed.ease,
        background: resolvedBackground,
        setFitDistance,
      };
    }
    const near =
      parsed.near ?? (fitDistance != null ? fitDistance * AUTO_NEAR_FACTOR : FALLBACK_NEAR);
    const far = parsed.far ?? (fitDistance != null ? fitDistance * AUTO_FAR_FACTOR : FALLBACK_FAR);
    return {
      enabled: true,
      near,
      far: Math.max(far, near + 1e-4),
      ease: parsed.ease,
      background: resolvedBackground,
      setFitDistance,
    };
  }, [parsed, fitDistance, resolvedBackground, setFitDistance]);

  return <GraphSceneFogContext.Provider value={value}>{children}</GraphSceneFogContext.Provider>;
}

/** Fog settings for the current {@link GraphScene}. Returns a disabled stub outside the provider. */
export function useGraphSceneFog(): GraphSceneFogValue {
  const ctx = useContext(GraphSceneFogContext);
  return (
    ctx ?? {
      enabled: false,
      near: FALLBACK_NEAR,
      far: FALLBACK_FAR,
      ease: DEFAULT_EASE,
      background: "transparent",
      setFitDistance: () => {},
    }
  );
}
