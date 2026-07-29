import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { MathUtils } from "three";

/**
 * Maps normalized depth `t` in `[0, 1]` (near→far) to channel strength in `[0, 1]`.
 * Named presets or a custom function.
 */
export type GraphSceneFogEase = "linear" | "smoothstep" | "smootherstep" | ((t: number) => number);

/** Per-channel distance bounds and interpolation (color wash or blur). */
export type GraphSceneFogChannelOptions = {
  /** World-space distance where this channel starts (factor 0). */
  near?: number;
  /** World-space distance where this channel is full (factor 1 before ease). */
  far?: number;
  /**
   * How this channel rises over `[near, far]`. Default `"smoothstep"`.
   * Custom `(t) => number` receives normalized depth `0..1` and should return strength `0..1`.
   */
  ease?: GraphSceneFogEase;
};

export type GraphSceneFogColorOptions = GraphSceneFogChannelOptions & {
  /** Max veil opacity at full strength (`0..1`). Default `1`. */
  strength?: number;
};

export type GraphSceneFogBlurOptions = GraphSceneFogChannelOptions & {
  /**
   * Max on-screen blur radius in CSS px at full strength (after Html scale compensation).
   * Default `4`.
   */
  max?: number;
};

export type GraphSceneFogOptions = {
  /** Shared default near for channels that omit their own. */
  near?: number;
  /** Shared default far for channels that omit their own. */
  far?: number;
  /** Shared default ease for channels that omit their own. */
  ease?: GraphSceneFogEase;
  /**
   * Color wash toward the scene background. Default on when fog is enabled.
   * Pass `false` to disable; `true` or options to configure independently of blur.
   */
  color?: boolean | GraphSceneFogColorOptions;
  /**
   * Depth blur on the marker. Default off (`fog={true}` keeps prior color-only behavior).
   * Pass `true` or options to enable with its own bounds/ease.
   */
  blur?: boolean | GraphSceneFogBlurOptions;
};

/** Opt-in depth fog: `true` uses auto near/far for color wash; object configures channels. */
export type GraphSceneFogProp = boolean | GraphSceneFogOptions;

export type GraphSceneFogChannel = {
  enabled: boolean;
  near: number;
  far: number;
  ease: GraphSceneFogEase;
  /** Color: max veil opacity. Blur: max blur radius in px. */
  amount: number;
};

export type GraphSceneFogValue = {
  /**
   * Fog prop is opted in (`true` or options object). Keeps marker chrome mounted so
   * color/blur can be toggled independently without remounting Html children.
   */
  active: boolean;
  /** At least one channel is enabled. */
  enabled: boolean;
  color: GraphSceneFogChannel;
  blur: GraphSceneFogChannel;
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
const DEFAULT_COLOR_STRENGTH = 1;
const DEFAULT_BLUR_MAX_PX = 4;

function applyFogEase(t: number, ease: GraphSceneFogEase): number {
  const x = MathUtils.clamp(t, 0, 1);
  if (typeof ease === "function") return MathUtils.clamp(ease(x), 0, 1);
  switch (ease) {
    case "linear":
      return x;
    case "smootherstep":
      return x * x * x * (x * (x * 6 - 15) + 10);
    case "smoothstep":
      return x * x * (3 - 2 * x);
  }
}

/** Normalized depth then eased channel strength in `[0, 1]`. */
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

/**
 * CSS `blur()` radius so on-screen softness tracks fog strength.
 * Compensates for drei Html `distanceFactor` scaling (markers shrink with distance).
 */
export function fogBlurCssPx(
  distance: number,
  near: number,
  far: number,
  amount: number,
  distanceFactor: number,
  ease: GraphSceneFogEase = DEFAULT_EASE,
): number {
  const t = fogFactor(distance, near, far, ease);
  const scale = Math.max(distanceFactor, 1e-6);
  return t * amount * (distance / scale);
}

type ParsedChannel = {
  enabled: boolean;
  near?: number;
  far?: number;
  ease: GraphSceneFogEase;
  amount: number;
};

export type ParsedGraphSceneFog = {
  /** Fog prop opted in (even if both channels are disabled). */
  active: boolean;
  enabled: boolean;
  color: ParsedChannel;
  blur: ParsedChannel;
  /** True when any enabled channel still needs auto near and/or far from fit. */
  needsFitDistance: boolean;
};

function parseChannelFlag(
  flag: boolean | GraphSceneFogChannelOptions | undefined,
  shared: { near?: number; far?: number; ease: GraphSceneFogEase },
  defaultEnabled: boolean,
  amount: number,
): ParsedChannel {
  if (flag === false) {
    return { enabled: false, ease: shared.ease, amount };
  }
  if (flag == null) {
    return {
      enabled: defaultEnabled,
      near: shared.near,
      far: shared.far,
      ease: shared.ease,
      amount,
    };
  }
  if (flag === true) {
    return {
      enabled: true,
      near: shared.near,
      far: shared.far,
      ease: shared.ease,
      amount,
    };
  }
  return {
    enabled: true,
    near: flag.near ?? shared.near,
    far: flag.far ?? shared.far,
    ease: flag.ease ?? shared.ease,
    amount,
  };
}

export function parseGraphSceneFogProp(fog: GraphSceneFogProp | undefined): ParsedGraphSceneFog {
  if (fog == null || fog === false) {
    const off: ParsedChannel = { enabled: false, ease: DEFAULT_EASE, amount: 0 };
    return { active: false, enabled: false, color: off, blur: off, needsFitDistance: false };
  }

  const shared =
    fog === true
      ? {
          near: undefined as number | undefined,
          far: undefined as number | undefined,
          ease: DEFAULT_EASE,
        }
      : {
          near: fog.near,
          far: fog.far,
          ease: fog.ease ?? DEFAULT_EASE,
        };

  const colorFlag = fog === true ? true : fog.color;
  const blurFlag = fog === true ? false : fog.blur;
  const colorAmount =
    fog !== true && typeof fog.color === "object" && fog.color != null
      ? MathUtils.clamp(fog.color.strength ?? DEFAULT_COLOR_STRENGTH, 0, 1)
      : DEFAULT_COLOR_STRENGTH;
  const blurAmount =
    fog !== true && typeof fog.blur === "object" && fog.blur != null
      ? Math.max(0, fog.blur.max ?? DEFAULT_BLUR_MAX_PX)
      : DEFAULT_BLUR_MAX_PX;

  const color = parseChannelFlag(colorFlag, shared, true, colorAmount);
  const blur = parseChannelFlag(blurFlag, shared, false, blurAmount);
  const enabled = color.enabled || blur.enabled;
  const needsFitDistance =
    enabled &&
    ((color.enabled && (color.near == null || color.far == null)) ||
      (blur.enabled && (blur.near == null || blur.far == null)));

  return { active: true, enabled, color, blur, needsFitDistance };
}

function resolveChannel(parsed: ParsedChannel, fitDistance: number | null): GraphSceneFogChannel {
  if (!parsed.enabled) {
    return {
      enabled: false,
      near: FALLBACK_NEAR,
      far: FALLBACK_FAR,
      ease: parsed.ease,
      amount: parsed.amount,
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
    amount: parsed.amount,
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

const DISABLED_CHANNEL: GraphSceneFogChannel = {
  enabled: false,
  near: FALLBACK_NEAR,
  far: FALLBACK_FAR,
  ease: DEFAULT_EASE,
  amount: 0,
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
      if (!parsed.needsFitDistance) return;
      setFitDistanceState((prev) => (prev != null && Math.abs(prev - d) < 1e-4 ? prev : d));
    },
    [parsed.needsFitDistance],
  );

  const resolvedBackground = useMemo(() => {
    if (!parsed.active || !parsed.color.enabled) return background;
    if (typeof document === "undefined") return background;
    const host = colorHost ?? document.body;
    return resolveCssColor(background, host);
  }, [parsed.active, parsed.color.enabled, background, colorHost]);

  const value = useMemo((): GraphSceneFogValue => {
    if (!parsed.active) {
      return {
        active: false,
        enabled: false,
        color: DISABLED_CHANNEL,
        blur: DISABLED_CHANNEL,
        background: resolvedBackground,
        setFitDistance,
      };
    }
    return {
      active: true,
      enabled: parsed.enabled,
      color: resolveChannel(parsed.color, fitDistance),
      blur: resolveChannel(parsed.blur, fitDistance),
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
      active: false,
      enabled: false,
      color: DISABLED_CHANNEL,
      blur: DISABLED_CHANNEL,
      background: "transparent",
      setFitDistance: () => {},
    }
  );
}
