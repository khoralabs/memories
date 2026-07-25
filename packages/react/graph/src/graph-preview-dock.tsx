import type { ReactNode } from "react";
import { EdgePreviewCard } from "./edge-billboard.js";
import { GraphOverlayContainer } from "./graph-overlay-container.js";
import { NodePreviewCard } from "./node-billboard.js";
import type { ProjectionPoint, SceneEdge } from "./projection-types.js";
import { useProjection } from "./use-projection.js";

/** Active preview target passed to a custom `GraphPreviewDock` render prop. */
export type GraphPreviewDockContent =
  | { kind: "node"; point: ProjectionPoint }
  | { kind: "edge"; edge: SceneEdge };

export type GraphPreviewDockProps = {
  /**
   * Optional render prop for the preview body. When omitted, the built-in
   * {@link NodePreviewCard} / {@link EdgePreviewCard} are used.
   */
  children?: (content: GraphPreviewDockContent) => ReactNode;
};

/**
 * Fixed bottom-right preview (node / edge properties) scoped to the graph viewport.
 * Preview target: debounced hover over node/edge (see `focusDelay` on the provider), else pin.
 *
 * @example Default (same as today)
 * ```tsx
 * <GraphPreviewDock />
 * ```
 *
 * @example Custom body
 * ```tsx
 * <GraphPreviewDock>
 *   {(content) =>
 *     content.kind === "node" ? (
 *       <MyNodePreview point={content.point} />
 *     ) : (
 *       <MyEdgePreview edge={content.edge} />
 *     )
 *   }
 * </GraphPreviewDock>
 * ```
 */
export function GraphPreviewDock({ children }: GraphPreviewDockProps) {
  const { graphPreview } = useProjection();

  if (!graphPreview) return null;

  const body = children ? (
    children(graphPreview)
  ) : graphPreview.kind === "edge" ? (
    <EdgePreviewCard edge={graphPreview.edge} open />
  ) : (
    <NodePreviewCard point={graphPreview.point} open />
  );

  return (
    <div className="flex items-end justify-end" aria-live="polite">
      <GraphOverlayContainer className="pointer-events-auto w-[min(28rem,calc(100vw-2rem))]">
        {body}
      </GraphOverlayContainer>
    </div>
  );
}
