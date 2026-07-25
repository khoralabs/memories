import { Html } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { DotIcon } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import * as THREE from "three";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { MeasuredText } from "./components/measured-text.js";
import { useGraphSceneRender } from "./graph-scene-slots.js";
import { FONT_TOOLTIP_BODY, FONT_TOOLTIP_KINDS } from "./lib/pretext-measure.js";
import type { GraphSceneNodeItem } from "./projection-types.js";
import { useProjection } from "./use-projection.js";

/** Screen-space scale vs distance; pairs with camera FOV / zoom (see drei `Html`). */
const MARKER_DISTANCE_FACTOR = 5;

const _nodeNdc = new THREE.Vector3();
const _centroidNdc = new THREE.Vector3();

export type GraphSceneNodeProps = {
  node: GraphSceneNodeItem;
  className?: string;
};

/**
 * Default graph node marker (Html button + optional tooltip).
 * Use inside {@link GraphScene.Nodes} or as the default when that slot is omitted.
 */
export function GraphSceneNode({ node, className }: GraphSceneNodeProps) {
  const { setSelected, onHoverStart, onHoverEnd } = useProjection();
  const { nodeLabelsVisible, searchHitPreviews, tooltipCentroid } = useGraphSceneRender();

  const tooltipLabelsLine = (
    node.labels.length > 0 ? node.labels.map((l) => l.kind) : [node.key]
  ).join(" • ");
  const snippet = searchHitPreviews ? node.searchHitSnippet : undefined;
  const tooltipCategoryAllowed = nodeLabelsVisible || searchHitPreviews;
  const hasTooltipContent = nodeLabelsVisible || !!snippet;
  const [userTooltipOpen, setUserTooltipOpen] = useState(false);
  const [tooltipSide, setTooltipSide] = useState<"left" | "right">("right");
  const tooltipOpen = hasTooltipContent && (node.forceTooltipOpen || userTooltipOpen);
  const sideRef = useRef<"left" | "right">("right");
  const [tooltipPortalEl, setTooltipPortalEl] = useState<HTMLDivElement | null>(null);
  const tooltipLayerRef = useCallback((el: HTMLDivElement | null) => {
    setTooltipPortalEl(el);
  }, []);
  const { camera } = useThree();

  useFrame(() => {
    _nodeNdc.set(node.position[0], node.position[1], node.position[2]);
    _centroidNdc.set(tooltipCentroid[0], tooltipCentroid[1], tooltipCentroid[2]);
    _nodeNdc.project(camera);
    _centroidNdc.project(camera);
    const dx = _nodeNdc.x - _centroidNdc.x;
    const next = dx >= 0 ? "right" : "left";
    if (sideRef.current !== next) {
      sideRef.current = next;
      setTooltipSide(next);
    }
  });

  const buttonEl = (
    <Button
      type="button"
      variant="outline"
      size="icon-sm"
      className={cn("rounded-full border border-black", className)}
      style={{
        opacity: node.dimmed ? 0.15 : 1,
        pointerEvents: "auto",
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        setSelected(node);
      }}
      onPointerEnter={() => onHoverStart(node.entryId)}
      onPointerLeave={() => onHoverEnd()}
    >
      <DotIcon />
    </Button>
  );

  const showTooltipChrome = tooltipCategoryAllowed && hasTooltipContent;

  const wrapped = showTooltipChrome ? (
    <TooltipProvider>
      <Tooltip
        open={tooltipOpen}
        onOpenChange={(open) => {
          if (!hasTooltipContent) return;
          if (node.forceTooltipOpen) {
            setUserTooltipOpen(false);
            return;
          }
          setUserTooltipOpen(open);
        }}
      >
        <TooltipTrigger asChild>{buttonEl}</TooltipTrigger>
        <TooltipContent
          key={tooltipSide}
          container={tooltipPortalEl}
          side={tooltipSide}
          className="opacity-50 p-3"
        >
          {nodeLabelsVisible ? (
            <MeasuredText
              text={tooltipLabelsLine}
              font={FONT_TOOLTIP_KINDS}
              lineHeight={16}
              maxWidth={280}
              maxLines={2}
              whiteSpace="normal"
              className="text-left text-xs"
              tooltipContainer={tooltipPortalEl}
              tooltipSide={tooltipSide}
            />
          ) : null}
          {snippet ? (
            <MeasuredText
              text={snippet}
              font={FONT_TOOLTIP_BODY}
              lineHeight={14}
              maxWidth={320}
              maxLines={6}
              whiteSpace="pre-wrap"
              className={cn(
                "text-left text-[10px] leading-snug",
                nodeLabelsVisible && "mt-2 border-t border-border/50 pt-2",
              )}
              tooltipContainer={tooltipPortalEl}
              tooltipSide={tooltipSide}
            />
          ) : null}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  ) : (
    buttonEl
  );

  return (
    <group position={node.position}>
      <Html
        center
        distanceFactor={MARKER_DISTANCE_FACTOR}
        className="r3f-html-marker-root"
        style={{ pointerEvents: "none" }}
      >
        <div ref={tooltipLayerRef} className="relative w-fit" style={{ pointerEvents: "auto" }}>
          {wrapped}
        </div>
      </Html>
    </group>
  );
}
GraphSceneNode.displayName = "GraphScene.Node";
