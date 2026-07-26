import { Html } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { DotIcon } from "lucide-react";
import {
  Children,
  type ComponentProps,
  createContext,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
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

type GraphSceneNodeContextValue = {
  node: GraphSceneNodeItem;
  tooltipSide: "left" | "right";
  tooltipPortalEl: HTMLDivElement | null;
  nodeLabelsVisible: boolean;
  snippet: string | undefined;
  tooltipLabelsLine: string;
};

const GraphSceneNodeContext = createContext<GraphSceneNodeContextValue | null>(null);

/** Node item + tooltip layout state for {@link GraphScene.NodeButton} / {@link GraphScene.NodeTooltip}. */
export function useGraphSceneNode(): GraphSceneNodeContextValue {
  const ctx = useContext(GraphSceneNodeContext);
  if (ctx == null) {
    throw new Error("useGraphSceneNode must be used within GraphScene.Node");
  }
  return ctx;
}

export type GraphSceneNodeButtonProps = ComponentProps<typeof Button>;

/**
 * Default node marker control. Provide `className` / `children` (or `asChild`) to restyle;
 * selection and hover wiring stay attached.
 */
export function GraphSceneNodeButton({
  className,
  children,
  variant = "outline",
  size = "icon-sm",
  style,
  ...props
}: GraphSceneNodeButtonProps) {
  const { node } = useGraphSceneNode();
  const { setSelected, onHoverStart, onHoverEnd } = useProjection();

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      {...props}
      className={cn("rounded-full border border-black", className)}
      style={{
        opacity: node.dimmed ? 0.15 : 1,
        pointerEvents: "auto",
        ...style,
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        setSelected(node);
      }}
      onPointerEnter={() => onHoverStart(node.entryId)}
      onPointerLeave={() => onHoverEnd()}
    >
      {children ?? <DotIcon />}
    </Button>
  );
}
GraphSceneNodeButton.displayName = "GraphScene.NodeButton";

export type GraphSceneNodeTooltipProps = {
  children?: ReactNode;
  className?: string;
};

/**
 * Node hover/force tooltip body. Omit `children` for the default labels + search snippet;
 * pass `children` to fully control tooltip text/layout (use {@link useGraphSceneNode} for data).
 */
export function GraphSceneNodeTooltip({ children, className }: GraphSceneNodeTooltipProps) {
  const { nodeLabelsVisible, snippet, tooltipLabelsLine, tooltipPortalEl, tooltipSide } =
    useGraphSceneNode();

  const body =
    children !== undefined ? (
      children
    ) : (
      <>
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
      </>
    );

  return (
    <TooltipContent
      key={tooltipSide}
      container={tooltipPortalEl}
      side={tooltipSide}
      className={cn("opacity-50 p-3", className)}
    >
      {body}
    </TooltipContent>
  );
}
GraphSceneNodeTooltip.displayName = "GraphScene.NodeTooltip";

export type GraphSceneNodeProps = {
  node: GraphSceneNodeItem;
  /** Applied to the default {@link GraphScene.NodeButton} when that slot is omitted. */
  className?: string;
  children?: ReactNode;
};

type NodeSlots = {
  button: ReactElement | null;
  tooltip: ReactElement | null;
};

function partitionGraphSceneNodeChildren(children: ReactNode | undefined): NodeSlots {
  const slots: NodeSlots = { button: null, tooltip: null };
  if (children == null) return slots;
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    if (child.type === GraphSceneNodeButton) slots.button = child;
    else if (child.type === GraphSceneNodeTooltip) slots.tooltip = child;
  });
  return slots;
}

/**
 * Default graph node marker (Html button + optional tooltip).
 * Use inside {@link GraphScene.Nodes} or as the default when that slot is omitted.
 *
 * Compound slots: {@link GraphScene.NodeButton}, {@link GraphScene.NodeTooltip}.
 * Omit children (or omit a slot) to keep the built-in defaults.
 *
 * @example
 * ```tsx
 * <GraphScene.Node node={node} />
 *
 * <GraphScene.Node node={node}>
 *   <GraphScene.NodeButton className="border-primary">★</GraphScene.NodeButton>
 *   <GraphScene.NodeTooltip>
 *     {node.labels.map((l) => l.kind).join(" · ")}
 *   </GraphScene.NodeTooltip>
 * </GraphScene.Node>
 * ```
 */
export function GraphSceneNode({ node, className, children }: GraphSceneNodeProps) {
  const { nodeLabelsVisible, searchHitPreviews, tooltipCentroid } = useGraphSceneRender();

  const tooltipLabelsLine = (
    node.labels.length > 0 ? node.labels.map((l) => l.kind) : [node.key]
  ).join(" • ");
  const snippet = searchHitPreviews ? node.searchHitSnippet : undefined;
  const tooltipCategoryAllowed = nodeLabelsVisible || searchHitPreviews;

  const slots = useMemo(() => partitionGraphSceneNodeChildren(children), [children]);
  const tooltipHasCustomChildren =
    slots.tooltip != null &&
    (slots.tooltip.props as GraphSceneNodeTooltipProps).children !== undefined;
  const hasTooltipContent = tooltipHasCustomChildren || nodeLabelsVisible || !!snippet;

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

  const ctx = useMemo(
    (): GraphSceneNodeContextValue => ({
      node,
      tooltipSide,
      tooltipPortalEl,
      nodeLabelsVisible,
      snippet,
      tooltipLabelsLine,
    }),
    [node, tooltipSide, tooltipPortalEl, nodeLabelsVisible, snippet, tooltipLabelsLine],
  );

  const buttonEl = slots.button ?? <GraphSceneNodeButton className={className} />;
  const tooltipEl = slots.tooltip ?? <GraphSceneNodeTooltip />;
  const showTooltipChrome =
    hasTooltipContent && (tooltipHasCustomChildren || tooltipCategoryAllowed);

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
        {tooltipEl}
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
          <GraphSceneNodeContext.Provider value={ctx}>{wrapped}</GraphSceneNodeContext.Provider>
        </div>
      </Html>
    </group>
  );
}
GraphSceneNode.displayName = "GraphScene.Node";
