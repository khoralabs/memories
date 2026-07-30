import { DepthOfField, EffectComposer } from "@react-three/postprocessing";
import { useGraphSceneFog } from "./graph-scene-fog.js";

/**
 * Half-res depth-of-field when `fog.blur` is enabled. Softens WebGL edge lines (and any other
 * depth-writing geometry); Html markers keep their own CSS blur.
 */
export function GraphSceneFogEffects() {
  const fog = useGraphSceneFog();
  if (!fog.blur.enabled) return null;

  const worldFocusRange = Math.max(fog.blur.far - fog.blur.near, 1e-3);
  // `amount` is Html CSS px max; map to a modest bokeh scale for the cheap pass.
  const bokehScale = Math.max(0.25, fog.blur.amount * 0.5);

  return (
    <EffectComposer multisampling={0} enableNormalPass={false}>
      <DepthOfField
        worldFocusDistance={fog.blur.near}
        worldFocusRange={worldFocusRange}
        bokehScale={bokehScale}
        resolutionScale={0.5}
      />
    </EffectComposer>
  );
}
