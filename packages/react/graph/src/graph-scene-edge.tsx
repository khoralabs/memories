import { Html, Line } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { type ComponentRef, useMemo, useRef } from "react";
import * as THREE from "three";
import { cn } from "@/lib/utils";
import type { GraphSceneEdgeItem, SceneEdge } from "./projection-types.js";
import { useProjection } from "./use-projection.js";

const PICK_RADIUS = 0.028;
const DASH_SCROLL_SPEED = 10;
const EDGE_HTML_DISTANCE_FACTOR = 5;

function scrollDashedLineMaterial(material: unknown, delta: number) {
  if (!material || typeof material !== "object") return;
  const m = material as { uniforms?: { dashOffset?: { value: number } }; dashOffset?: number };
  if (m.uniforms?.dashOffset) {
    m.uniforms.dashOffset.value -= DASH_SCROLL_SPEED * delta;
    return;
  }
  if (typeof m.dashOffset === "number") {
    m.dashOffset -= DASH_SCROLL_SPEED * delta;
  }
}

const dashedLineDefaults = {
  color: "black" as const,
  lineWidth: 1,
  transparent: true,
  depthTest: true,
  depthWrite: false,
  renderOrder: 0,
  dashed: true,
  dashScale: 100,
  dashSize: 3,
  gapSize: 5,
};

function GraphDashedEdgeLineAnimated({
  from,
  to,
  opacity,
}: {
  from: [number, number, number];
  to: [number, number, number];
  opacity: number;
}) {
  const lineRef = useRef<ComponentRef<typeof Line>>(null);
  useFrame((_, delta) => {
    const line = lineRef.current;
    if (!line) return;
    const mat = line.material;
    scrollDashedLineMaterial(Array.isArray(mat) ? mat[0] : mat, delta);
  });
  return <Line ref={lineRef} points={[from, to]} opacity={opacity} {...dashedLineDefaults} />;
}

function GraphDashedEdgeLine({
  from,
  to,
  opacity,
  animateDash,
}: {
  from: [number, number, number];
  to: [number, number, number];
  opacity: number;
  animateDash: boolean;
}) {
  return animateDash ? (
    <GraphDashedEdgeLineAnimated from={from} to={to} opacity={opacity} />
  ) : (
    <Line points={[from, to]} opacity={opacity} {...dashedLineDefaults} />
  );
}

function EdgePickCylinder({
  edge,
  from,
  to,
}: {
  edge: SceneEdge;
  from: [number, number, number];
  to: [number, number, number];
}) {
  const { onEdgeHoverStart, onEdgeHoverEnd, setPinnedEdge } = useProjection();

  const { position, quaternion, length } = useMemo(() => {
    const a = new THREE.Vector3(...from);
    const b = new THREE.Vector3(...to);
    const dir = b.clone().sub(a);
    const len = dir.length();
    const mid = dir.clone().multiplyScalar(0.5).add(a);
    const q = new THREE.Quaternion();
    q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    return { position: mid, quaternion: q, length: len };
  }, [from, to]);

  return (
    <group position={position} quaternion={quaternion}>
      <mesh
        renderOrder={1}
        onPointerOver={(e) => {
          e.stopPropagation();
          onEdgeHoverStart(edge.key);
        }}
        onPointerOut={(e) => {
          e.stopPropagation();
          onEdgeHoverEnd();
        }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          setPinnedEdge(edge);
        }}
      >
        <cylinderGeometry args={[PICK_RADIUS, PICK_RADIUS, Math.max(length, 0.001), 8]} />
        <meshBasicMaterial transparent opacity={0.001} depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  );
}

export type GraphSceneEdgeProps = {
  edge: GraphSceneEdgeItem;
  className?: string;
};

/**
 * Default graph edge (dashed Line + pick cylinder).
 * `className` applies to a mid-edge Html hook for CSS chrome (Line stroke stays Three.js).
 */
export function GraphSceneEdge({ edge, className }: GraphSceneEdgeProps) {
  const mid: [number, number, number] = [
    (edge.from[0] + edge.to[0]) / 2,
    (edge.from[1] + edge.to[1]) / 2,
    (edge.from[2] + edge.to[2]) / 2,
  ];

  return (
    <group>
      <GraphDashedEdgeLine
        from={edge.from}
        to={edge.to}
        opacity={edge.opacity}
        animateDash={edge.animateDash}
      />
      <EdgePickCylinder edge={edge} from={edge.from} to={edge.to} />
      {className ? (
        <group position={mid}>
          <Html center distanceFactor={EDGE_HTML_DISTANCE_FACTOR} style={{ pointerEvents: "none" }}>
            <span className={cn("pointer-events-none", className)} aria-hidden />
          </Html>
        </group>
      ) : null}
    </group>
  );
}
GraphSceneEdge.displayName = "GraphScene.Edge";
