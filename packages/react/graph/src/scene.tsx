import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  type ComponentRef,
  type CSSProperties,
  Fragment,
  type ReactNode,
  type RefObject,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as THREE from "three";
import { cn } from "@/lib/utils";
import { ActiveSubgraphEdgeLabels, type GraphEdgeRenderMode } from "./edges.js";
import { GraphCameraChromeProvider, useGraphCameraChrome } from "./graph-camera-chrome.js";
import { GraphSceneEdge } from "./graph-scene-edge.js";
import {
  type GraphSceneFogProp,
  GraphSceneFogProvider,
  useGraphSceneFog,
} from "./graph-scene-fog.js";
import { GraphSceneFogEffects } from "./graph-scene-fog-effects.js";
import { GraphSceneNode, GraphSceneNodeButton, GraphSceneNodeTooltip } from "./graph-scene-node.js";
import {
  GraphSceneBottomLeft,
  GraphSceneBottomRight,
  GraphSceneCenter,
  type GraphSceneEdgeRender,
  GraphSceneEdges,
  type GraphSceneNodeRender,
  GraphSceneNodes,
  GraphSceneRenderProvider,
  GraphSceneTopLeft,
  GraphSceneTopRight,
  partitionGraphSceneChildren,
} from "./graph-scene-slots.js";
import type { GraphSceneEdgeItem, GraphSceneNodeItem } from "./projection-types.js";
import { SCALE } from "./projection-types.js";
import { useProjection } from "./use-projection.js";
import { useSuppressBenignResizeObserverErrors } from "./use-suppress-benign-resize-observer-errors.js";

/**
 * Padding around the node AABB (drei `Bounds` `margin` equivalent). Tighter than the old `margin={2}`.
 */
const GRAPH_BOUNDS_MARGIN = 1.32;
/** Min AABB extent (world units after SCALE) so 1-node graphs don't collapse the camera. */
const MIN_GRAPH_FIT_EXTENT = 2;

const _min = new THREE.Vector3();
const _max = new THREE.Vector3();
const _center = new THREE.Vector3();
const _dir = new THREE.Vector3();

/** Fit camera from graph node positions — deterministic; avoids drei Bounds + Html timing bugs. */
function fitPerspectiveCameraToGraph(
  camera: THREE.PerspectiveCamera,
  controls: { target: THREE.Vector3; update: () => void },
  points: readonly { x: number; y: number; z: number }[],
  margin: number,
  options?: { viewDirection?: THREE.Vector3; minFitExtent?: number },
): number | undefined {
  if (points.length === 0) return;
  _min.set(Infinity, Infinity, Infinity);
  _max.set(-Infinity, -Infinity, -Infinity);
  for (const p of points) {
    const x = p.x * SCALE;
    const y = p.y * SCALE;
    const z = p.z * SCALE;
    _min.x = Math.min(_min.x, x);
    _min.y = Math.min(_min.y, y);
    _min.z = Math.min(_min.z, z);
    _max.x = Math.max(_max.x, x);
    _max.y = Math.max(_max.y, y);
    _max.z = Math.max(_max.z, z);
  }
  const cx = (_min.x + _max.x) / 2;
  const cy = (_min.y + _max.y) / 2;
  const cz = (_min.z + _max.z) / 2;
  const minFitExtent = options?.minFitExtent ?? MIN_GRAPH_FIT_EXTENT;
  const maxSize = Math.max(_max.x - _min.x, _max.y - _min.y, _max.z - _min.z, minFitExtent);

  // Same vertical/horizontal fit as @react-three/drei Bounds `getSize` (perspective).
  const fitHeightDistance = maxSize / (2 * Math.atan((Math.PI * camera.fov) / 360));
  const fitWidthDistance = fitHeightDistance / camera.aspect;
  const distance = margin * Math.max(fitHeightDistance, fitWidthDistance);

  _center.set(cx, cy, cz);
  if (options?.viewDirection) {
    _dir.copy(options.viewDirection).normalize();
  } else {
    _dir.subVectors(camera.position, _center);
    if (_dir.lengthSq() < 1e-10) {
      _dir.set(1, 0.35, 1).normalize();
    } else {
      _dir.normalize();
    }
  }

  camera.position.set(cx + _dir.x * distance, cy + _dir.y * distance, cz + _dir.z * distance);
  controls.target.set(cx, cy, cz);
  camera.near = Math.max(distance / 100, 0.01);
  camera.far = Math.max(distance * 100, 1000);
  const oc = controls as unknown as { maxDistance?: number };
  if (typeof oc.maxDistance === "number") oc.maxDistance = distance * 10;
  camera.updateProjectionMatrix();
  controls.update();
  return distance;
}

const _defaultOrbitView = new THREE.Vector3(1, 0.35, 1).normalize();

function GraphCameraController({
  points,
  orbitTarget,
  controlsRef,
  minFitExtent = MIN_GRAPH_FIT_EXTENT,
}: {
  points: readonly { x: number; y: number; z: number }[];
  orbitTarget: readonly [number, number, number];
  controlsRef: RefObject<ComponentRef<typeof OrbitControls> | null>;
  /** Min AABB extent (world units after SCALE) so small graphs don't collapse the camera. */
  minFitExtent?: number;
}) {
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  const { width: viewWidth, height: viewHeight } = useThree((s) => s.size);
  const { setCameraViewDeviated, reframeRef } = useGraphCameraChrome();
  const { setFitDistance } = useGraphSceneFog();

  const homePos = useRef(new THREE.Vector3());
  const homeTarget = useRef(new THREE.Vector3());
  const homeReady = useRef(false);
  const prevDeviated = useRef(false);
  /** Camera→target direction after the first fit for this `points` snapshot — used when reframing. */
  const originalOrbitDirRef = useRef<THREE.Vector3 | null>(null);
  const prevPointsRef = useRef<readonly { x: number; y: number; z: number }[] | null>(null);

  const snapshotHome = useCallback(() => {
    if (!(camera instanceof THREE.PerspectiveCamera)) return;
    const ctrl = controlsRef.current;
    if (!ctrl) return;
    if (originalOrbitDirRef.current === null && points.length > 0) {
      originalOrbitDirRef.current = new THREE.Vector3()
        .subVectors(camera.position, ctrl.target)
        .normalize();
    }
    homePos.current.copy(camera.position);
    homeTarget.current.copy(ctrl.target);
    homeReady.current = true;
    prevDeviated.current = false;
    setCameraViewDeviated(false);
  }, [camera, controlsRef, points.length, setCameraViewDeviated]);

  const runFit = useCallback(
    (resetOrbitToOriginal?: boolean) => {
      void viewWidth;
      void viewHeight;
      if (prevPointsRef.current !== points) {
        prevPointsRef.current = points;
        originalOrbitDirRef.current = null;
      }
      const ctrl = controlsRef.current;
      if (!ctrl || !(camera instanceof THREE.PerspectiveCamera)) return;
      if (points.length === 0) {
        homeReady.current = false;
        setCameraViewDeviated(false);
        return;
      }
      const viewDir = resetOrbitToOriginal
        ? (originalOrbitDirRef.current ?? _defaultOrbitView)
        : undefined;
      const fitDistance = fitPerspectiveCameraToGraph(
        camera,
        ctrl as unknown as { target: THREE.Vector3; update: () => void },
        points,
        GRAPH_BOUNDS_MARGIN,
        {
          minFitExtent,
          ...(viewDir ? { viewDirection: viewDir } : {}),
        },
      );
      if (fitDistance != null) setFitDistance(fitDistance);
      ctrl.target.set(orbitTarget[0], orbitTarget[1], orbitTarget[2]);
      ctrl.update();
      invalidate();
      snapshotHome();
    },
    [
      camera,
      controlsRef,
      invalidate,
      minFitExtent,
      orbitTarget,
      points,
      snapshotHome,
      setCameraViewDeviated,
      setFitDistance,
      viewWidth,
      viewHeight,
    ],
  );

  useLayoutEffect(() => {
    runFit();
    const t0 = window.setTimeout(runFit, 0);
    let rafInner = 0;
    const rafOuter = requestAnimationFrame(() => {
      rafInner = requestAnimationFrame(() => {
        runFit();
      });
    });
    const t1 = window.setTimeout(runFit, 120);
    return () => {
      window.clearTimeout(t0);
      window.clearTimeout(t1);
      cancelAnimationFrame(rafOuter);
      cancelAnimationFrame(rafInner);
    };
  }, [runFit]);

  useLayoutEffect(() => {
    reframeRef.current = () => {
      runFit(true);
    };
    return () => {
      reframeRef.current = null;
    };
  }, [reframeRef, runFit]);

  useFrame(() => {
    if (!homeReady.current || !(camera instanceof THREE.PerspectiveCamera)) return;
    const ctrl = controlsRef.current;
    if (!ctrl) return;
    const eps = 0.035;
    const posDiff = camera.position.distanceTo(homePos.current);
    const tgtDiff = ctrl.target.distanceTo(homeTarget.current);
    const deviated = posDiff > eps || tgtDiff > eps;
    if (deviated !== prevDeviated.current) {
      prevDeviated.current = deviated;
      setCameraViewDeviated(deviated);
    }
  });

  return null;
}

/** Axis-aligned center of all node positions in world space (matches graph extent). */
function useOrbitTarget(points: { x: number; y: number; z: number }[]): [number, number, number] {
  return useMemo(() => {
    if (points.length === 0) return [0, 0, 0];
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (const p of points) {
      const x = p.x * SCALE;
      const y = p.y * SCALE;
      const z = p.z * SCALE;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      minZ = Math.min(minZ, z);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      maxZ = Math.max(maxZ, z);
    }
    return [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
  }, [points]);
}

export type { GraphEdgeRenderMode };

/** Visual toggles for the 3D graph layer (edges, labels, search snippets). All default to true. */
export type GraphSceneOverlayOptions = {
  edgesVisible?: boolean;
  searchHitPreviews?: boolean;
  /** Edge midpoint search snippets; defaults to {@link searchHitPreviews}. */
  edgeSearchHitPreviews?: boolean;
  edgeLabelsVisible?: boolean;
  nodeLabelsVisible?: boolean;
};

export type GraphSceneResolvedOverlay = Required<GraphSceneOverlayOptions>;

export function resolveGraphSceneOverlay(
  partial?: GraphSceneOverlayOptions,
): GraphSceneResolvedOverlay {
  const searchHitPreviews = partial?.searchHitPreviews ?? true;
  return {
    edgesVisible: partial?.edgesVisible ?? true,
    searchHitPreviews,
    edgeSearchHitPreviews: partial?.edgeSearchHitPreviews ?? searchHitPreviews,
    edgeLabelsVisible: partial?.edgeLabelsVisible ?? true,
    nodeLabelsVisible: partial?.nodeLabelsVisible ?? true,
  };
}

function GraphSceneR3f({
  edgeRenderMode,
  overlay,
  nodesRender,
  edgesRender,
  minFitExtent,
  background,
}: {
  edgeRenderMode: GraphEdgeRenderMode;
  overlay: GraphSceneResolvedOverlay;
  nodesRender: GraphSceneNodeRender | null;
  edgesRender: GraphSceneEdgeRender | null;
  minFitExtent?: number;
  background: string;
}) {
  const {
    points,
    sceneEdges,
    focusEntryId,
    activeSubgraphKeys,
    hasGraphSubgraphFocus,
    hasGraphSubgraphStrongFocus,
    graphSearch,
    clearHover,
  } = useProjection();

  const orbitTarget = useOrbitTarget(points);
  const controlsRef = useRef<ComponentRef<typeof OrbitControls>>(null);
  const onCameraNavStart = useCallback(() => {
    clearHover();
  }, [clearHover]);

  const posMap = useMemo(() => {
    const m = new Map<string, [number, number, number]>();
    for (const p of points) {
      m.set(p.entryId, [p.x * SCALE, p.y * SCALE, p.z * SCALE]);
    }
    return m;
  }, [points]);

  /** Mean position for tooltip “outward” rule: active subgraph if any, else full graph. */
  const tooltipCentroid = useMemo((): [number, number, number] => {
    const useSubgraph = activeSubgraphKeys !== null && activeSubgraphKeys.size > 0;
    const subset = useSubgraph ? points.filter((p) => activeSubgraphKeys.has(p.entryId)) : points;
    const basis = subset.length > 0 ? subset : points;
    if (basis.length === 0) return [0, 0, 0];
    let sx = 0;
    let sy = 0;
    let sz = 0;
    for (const p of basis) {
      sx += p.x * SCALE;
      sy += p.y * SCALE;
      sz += p.z * SCALE;
    }
    const n = basis.length;
    return [sx / n, sy / n, sz / n];
  }, [points, activeSubgraphKeys]);

  const nodeItems = useMemo((): GraphSceneNodeItem[] => {
    return points.map((point) => {
      const position: [number, number, number] = [
        point.x * SCALE,
        point.y * SCALE,
        point.z * SCALE,
      ];
      const inActiveSubgraph = !!activeSubgraphKeys?.has(point.entryId);
      const searchDimmed =
        graphSearch !== null &&
        graphSearch.relevantKeys.size > 0 &&
        !graphSearch.relevantKeys.has(point.entryId) &&
        !inActiveSubgraph;
      const subgraphDimmed =
        activeSubgraphKeys !== null &&
        point.entryId !== focusEntryId &&
        !activeSubgraphKeys.has(point.entryId);
      const searchHitSnippet = overlay.searchHitPreviews
        ? graphSearch?.hitSnippetByKey.get(point.entryId)
        : undefined;
      return {
        ...point,
        position,
        dimmed: searchDimmed || subgraphDimmed,
        forceTooltipOpen: !!activeSubgraphKeys?.has(point.entryId),
        ...(searchHitSnippet !== undefined ? { searchHitSnippet } : {}),
      };
    });
  }, [points, activeSubgraphKeys, focusEntryId, graphSearch, overlay.searchHitPreviews]);

  const edgeItems = useMemo((): GraphSceneEdgeItem[] => {
    if (!overlay.edgesVisible) return [];
    if (edgeRenderMode === "activeOnly" && !hasGraphSubgraphFocus) return [];

    const out: GraphSceneEdgeItem[] = [];
    for (const e of sceneEdges) {
      const from = posMap.get(e.fromKey);
      const to = posMap.get(e.toKey);
      if (!from || !to) continue;

      const searchLit =
        graphSearch === null ||
        hasGraphSubgraphStrongFocus ||
        (graphSearch.relevantKeys.has(e.fromKey) && graphSearch.relevantKeys.has(e.toKey));
      const subgraphLit =
        activeSubgraphKeys === null
          ? !hasGraphSubgraphFocus
          : activeSubgraphKeys.has(e.fromKey) && activeSubgraphKeys.has(e.toKey);
      const lit = searchLit && subgraphLit;

      if (edgeRenderMode === "activeOnly" && !lit) continue;

      const inPinnedSubgraph = !!(
        hasGraphSubgraphStrongFocus &&
        activeSubgraphKeys?.has(e.fromKey) &&
        activeSubgraphKeys.has(e.toKey)
      );

      out.push({
        ...e,
        from,
        to,
        lit,
        opacity: lit ? 0.5 : 0.07,
        animateDash: inPinnedSubgraph && !!e.directed,
      });
    }
    return out;
  }, [
    overlay.edgesVisible,
    edgeRenderMode,
    hasGraphSubgraphFocus,
    hasGraphSubgraphStrongFocus,
    sceneEdges,
    posMap,
    graphSearch,
    activeSubgraphKeys,
  ]);

  const renderNode = nodesRender ?? ((node: GraphSceneNodeItem) => <GraphSceneNode node={node} />);
  const renderEdge = edgesRender ?? ((edge: GraphSceneEdgeItem) => <GraphSceneEdge edge={edge} />);

  const renderCtx = useMemo(
    () => ({
      nodesRender,
      edgesRender,
      nodeLabelsVisible: overlay.nodeLabelsVisible,
      searchHitPreviews: overlay.searchHitPreviews,
      tooltipCentroid,
    }),
    [
      nodesRender,
      edgesRender,
      overlay.nodeLabelsVisible,
      overlay.searchHitPreviews,
      tooltipCentroid,
    ],
  );

  return (
    <GraphSceneRenderProvider value={renderCtx}>
      <color attach="background" args={[background]} />
      <ambientLight intensity={0.8} />
      <pointLight position={[8, 8, 8]} intensity={40} />
      <pointLight position={[-8, -8, -4]} intensity={12} color="#8ab4ff" />
      <group>
        {edgeItems.map((edge) => (
          <Fragment key={edge.key}>{renderEdge(edge)}</Fragment>
        ))}
        {overlay.edgeLabelsVisible ? (
          <ActiveSubgraphEdgeLabels
            edges={sceneEdges}
            posMap={posMap}
            activeSubgraphKeys={activeSubgraphKeys}
            edgeSearchHitPreviews={overlay.edgeSearchHitPreviews}
            hitSnippetByEdgeId={graphSearch?.hitSnippetByEdgeId}
          />
        ) : null}
        {nodeItems.map((node) => (
          <Fragment key={node.entryId}>{renderNode(node)}</Fragment>
        ))}
      </group>
      <OrbitControls
        ref={controlsRef}
        target={orbitTarget}
        enableDamping
        makeDefault
        onStart={onCameraNavStart}
      />
      <GraphCameraController
        controlsRef={controlsRef}
        orbitTarget={orbitTarget}
        points={points}
        minFitExtent={minFitExtent}
      />
      <GraphSceneFogEffects />
    </GraphSceneRenderProvider>
  );
}

export type GraphSceneProps = {
  edgeRenderMode?: GraphEdgeRenderMode;
  overlay?: GraphSceneOverlayOptions;
  /**
   * Minimum AABB extent (world units after SCALE) used when fitting the camera.
   * Larger values pull the camera farther back on small/single-node graphs (default `2`).
   */
  minFitExtent?: number;
  /** Three.js scene clear color (default `var(--card)`). */
  background?: string;
  /**
   * Opt-in depth fog for Html node markers and WebGL edge lines.
   * Color washes markers (CSS veil) and edges (line color) toward {@link background}.
   * Blur uses CSS on Html markers and a cheap half-res depth-of-field pass on the canvas
   * (edges and other depth-writing geometry) — each channel has its own bounds and ease.
   * `true` enables color wash only (auto near/far). Pass `{ color, blur }` for independent control.
   */
  fog?: GraphSceneFogProp;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
};

function GraphSceneRoot({
  edgeRenderMode = "all",
  overlay,
  minFitExtent,
  background = "var(--card)",
  fog,
  className,
  style,
  children,
}: GraphSceneProps) {
  useSuppressBenignResizeObserverErrors();
  const slots = partitionGraphSceneChildren(children);
  const overlayResolved = resolveGraphSceneOverlay(overlay);
  const [colorHost, setColorHost] = useState<HTMLDivElement | null>(null);

  return (
    <GraphCameraChromeProvider>
      <div className={cn("relative h-full min-h-0 w-full", className)} style={style}>
        {slots.topLeft != null ? (
          <div className="pointer-events-auto absolute top-0 left-0 z-20 m-4 flex flex-col gap-4">
            {slots.topLeft}
          </div>
        ) : null}
        {slots.topRight != null ? (
          <div className="pointer-events-auto absolute top-0 right-0 z-20 m-4 flex items-center justify-end gap-2">
            {slots.topRight}
          </div>
        ) : null}
        {slots.bottomLeft != null ? (
          <div className="pointer-events-auto absolute bottom-0 left-0 z-20 m-4">
            {slots.bottomLeft}
          </div>
        ) : null}
        {slots.bottomRight != null ? (
          <div className="pointer-events-none absolute right-0 bottom-0 z-30 flex items-end justify-end p-4">
            {slots.bottomRight}
          </div>
        ) : null}
        {slots.center != null ? (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
            {slots.center}
          </div>
        ) : null}
        <div ref={setColorHost} className="absolute inset-0 z-0 min-h-0">
          <Canvas
            className="h-full w-full touch-none"
            camera={{ position: [0, 0, 4.8], fov: 20 }}
            dpr={[1, 2]}
            gl={{
              alpha: false,
              antialias: true,
              depth: true,
              stencil: false,
              powerPreference: "high-performance",
              preserveDrawingBuffer: false,
            }}
          >
            <GraphSceneFogProvider fog={fog} background={background} colorHost={colorHost}>
              <GraphSceneR3f
                edgeRenderMode={edgeRenderMode}
                overlay={overlayResolved}
                nodesRender={slots.nodesRender}
                edgesRender={slots.edgesRender}
                minFitExtent={minFitExtent}
                background={background}
              />
            </GraphSceneFogProvider>
          </Canvas>
        </div>
      </div>
    </GraphCameraChromeProvider>
  );
}

/**
 * R3F canvas + composable overlay slots (`TopLeft` / `TopRight` / `BottomLeft` / `BottomRight` /
 * `Center`) and optional `Nodes` / `Edges` render-prop slots for custom markers. Must be wrapped
 * in {@link GraphProjectionProvider}.
 *
 * @example
 * ```tsx
 * <GraphScene>
 *   <GraphScene.Nodes>
 *     {(node) => (
 *       <GraphScene.Node node={node}>
 *         <GraphScene.NodeButton className="border-primary" />
 *       </GraphScene.Node>
 *     )}
 *   </GraphScene.Nodes>
 *   <GraphScene.Edges>
 *     {(edge) => <GraphScene.Edge edge={edge} />}
 *   </GraphScene.Edges>
 * </GraphScene>
 * ```
 *
 * Use {@link GraphSceneOverlayOptions} (`overlay` prop) to hide edges, edge/node labels, or search
 * hit snippets in tooltips. When `Nodes` / `Edges` are omitted, built-in defaults are used.
 * Pass `minFitExtent` to override how tightly the camera fits small/single-node graphs (default `2`).
 */
export const GraphScene = Object.assign(GraphSceneRoot, {
  TopLeft: GraphSceneTopLeft,
  TopRight: GraphSceneTopRight,
  BottomLeft: GraphSceneBottomLeft,
  BottomRight: GraphSceneBottomRight,
  Center: GraphSceneCenter,
  Nodes: GraphSceneNodes,
  Node: GraphSceneNode,
  NodeButton: GraphSceneNodeButton,
  NodeTooltip: GraphSceneNodeTooltip,
  Edges: GraphSceneEdges,
  Edge: GraphSceneEdge,
});
