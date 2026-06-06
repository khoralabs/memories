import { Html } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { DotIcon } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import * as THREE from "three";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { MeasuredText } from "./components/measured-text.js";
import { FONT_TOOLTIP_BODY, FONT_TOOLTIP_KINDS } from "./lib/pretext-measure.js";
import { type ProjectionPoint, SCALE } from "./projection-types.js";

/** Screen-space scale vs distance; pairs with camera FOV / zoom (see drei `Html`). */
const MARKER_DISTANCE_FACTOR = 5;

const _nodeNdc = new THREE.Vector3();
const _centroidNdc = new THREE.Vector3();

export function Marker({
  point,
  dimmed,
  forceTooltipOpen,
  tooltipCentroid,
  nodeLabelsVisible = true,
  searchHitPreviews = true,
  searchHitSnippet,
  onSelect,
  onHoverStart,
  onHoverEnd,
}: {
  point: ProjectionPoint;
  dimmed: boolean;
  /** When true, subgraph nodes request tooltip stay-open (only when there is tooltip body content). */
  forceTooltipOpen: boolean;
  /** Mean position (scaled world space) for outward tooltip side: subgraph or full graph. */
  tooltipCentroid: readonly [number, number, number];
  /** Ontology kinds / key line in tooltip. */
  nodeLabelsVisible?: boolean;
  /** Search hit body text in tooltip (per-node when present). */
  searchHitPreviews?: boolean;
  /** Matched `text_features` text for this memory's search hit source map (root hits only). */
  searchHitSnippet?: string;
  onSelect: (point: ProjectionPoint) => void;
  onHoverStart: (entryId: string) => void;
  onHoverEnd: () => void;
}) {
  const tooltipLabelsLine = (
    point.labels.length > 0 ? point.labels.map((l) => l.kind) : [point.key]
  ).join(" • ");
  const snippet = searchHitPreviews ? searchHitSnippet : undefined;
  const tooltipCategoryAllowed = nodeLabelsVisible || searchHitPreviews;
  const hasTooltipContent = nodeLabelsVisible || !!snippet;
  const [userTooltipOpen, setUserTooltipOpen] = useState(false);
  const [tooltipSide, setTooltipSide] = useState<"left" | "right">("right");
  const tooltipOpen = hasTooltipContent && (forceTooltipOpen || userTooltipOpen);
  const sideRef = useRef<"left" | "right">("right");
  /** Portal tooltips here so they share the drei Html stacking layer (not `document.body`). */
  const [tooltipPortalEl, setTooltipPortalEl] = useState<HTMLDivElement | null>(null);
  const tooltipLayerRef = useCallback((el: HTMLDivElement | null) => {
    setTooltipPortalEl(el);
  }, []);
  const { camera } = useThree();

  useFrame(() => {
    _nodeNdc.set(point.x * SCALE, point.y * SCALE, point.z * SCALE);
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
      className="rounded-full border border-black"
      style={{
        opacity: dimmed ? 0.15 : 1,
        pointerEvents: "auto",
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        onSelect(point);
      }}
      onPointerEnter={() => onHoverStart(point.entryId)}
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
          if (forceTooltipOpen) {
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
    <group position={[point.x * SCALE, point.y * SCALE, point.z * SCALE]}>
      {/*
        Html root passes events through to the canvas (orbit/zoom). Only the inner control
        uses pointer-events:auto so empty space around the dot does not eat drags/wheel.
      */}
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
