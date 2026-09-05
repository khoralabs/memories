import type { ReactNode } from "react";
import { EdgeBillboard } from "@/components/memories/edge-billboard";
import { GraphOverlayContainer } from "@/components/memories/graph-overlay-container";
import { NodeBillboard } from "@/components/memories/node-billboard";
import type { ProjectionPoint, SceneEdge } from "@/components/memories/projection-types";
import { useProjection } from "@/components/memories/use-projection";

/** Active preview target passed to a custom `GraphPreviewDock` render prop. */
export type GraphPreviewDockContent =
  | { kind: "node"; point: ProjectionPoint }
  | { kind: "edge"; edge: SceneEdge };

export type GraphPreviewDockProps = {
  /**
   * Optional render prop for the preview body. When provided, **fully replaces** the
   * built-in {@link NodeBillboard} / {@link EdgeBillboard} (no default composition).
   */
  children?: (content: GraphPreviewDockContent) => ReactNode;
};

/**
 * Fixed bottom-right preview (node / edge properties) scoped to the graph viewport.
 * Preview target: debounced hover over node/edge (see `focusDelay` on the provider), else pin.
 *
 * When `children` is provided it **fully replaces** the default {@link NodeBillboard} /
 * {@link EdgeBillboard} (nothing else is rendered in the dock body).
 *
 * Ontology label `props` are not freeform node/edge `properties` — see billboard `Labels` vs `Metadata`.
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
 *       <NodeBillboard point={content.point} open>
 *         {(node) => <MyNodePreview node={node} />}
 *       </NodeBillboard>
 *     ) : (
 *       <EdgeBillboard edge={content.edge} open />
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
    <EdgeBillboard edge={graphPreview.edge} open />
  ) : (
    <NodeBillboard point={graphPreview.point} open />
  );

  return (
    <div className="flex items-end justify-end" aria-live="polite">
      <GraphOverlayContainer className="pointer-events-auto w-[min(28rem,calc(100vw-2rem))]">
        {body}
      </GraphOverlayContainer>
    </div>
  );
}
