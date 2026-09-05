import { lazy, Suspense } from "react";
import { useGraphSceneFog } from "@/components/memories/graph-scene-fog";

const GraphSceneFogEffectsImpl = lazy(() =>
  import("@/components/memories/graph-scene-fog-effects-impl").then((m) => ({
    default: m.GraphSceneFogEffectsImpl,
  })),
);

/**
 * Half-res depth-of-field when `fog.blur.edges` is on. Softens WebGL edge lines (and any other
 * depth-writing geometry); Html markers keep their own CSS blur via `fog.blur.nodes`.
 * Dynamically imports `@react-three/postprocessing` so GraphScene stays lean when edge blur is off.
 */
export function GraphSceneFogEffects() {
  const fog = useGraphSceneFog();
  if (!fog.blur.edges) return null;

  return (
    <Suspense fallback={null}>
      <GraphSceneFogEffectsImpl />
    </Suspense>
  );
}
