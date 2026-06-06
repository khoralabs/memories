import { EdgePreviewCard } from "./edge-billboard.js";
import { GraphOverlayContainer } from "./graph-overlay-container.js";
import { NodePreviewCard } from "./node-billboard.js";
import { useProjection } from "./use-projection.js";

/**
 * Fixed bottom-right preview (node / edge properties) scoped to the graph viewport.
 * Preview target: debounced hover over node/edge (see `focusDelay` on the provider), else pin.
 */
export function GraphPreviewDock() {
  const { graphPreview } = useProjection();

  if (!graphPreview) return null;

  return (
    <div className="flex items-end justify-end" aria-live="polite">
      <GraphOverlayContainer className="pointer-events-auto w-[min(28rem,calc(100vw-2rem))]">
        {graphPreview.kind === "edge" ? (
          <EdgePreviewCard edge={graphPreview.edge} open />
        ) : (
          <NodePreviewCard point={graphPreview.point} open />
        )}
      </GraphOverlayContainer>
    </div>
  );
}
