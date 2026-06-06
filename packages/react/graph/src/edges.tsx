import { Html, Line } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { type ComponentRef, useMemo, useRef } from "react";
import * as THREE from "three";
import { MeasuredText } from "./components/measured-text.js";
import { FONT_EDGE_BODY, FONT_EDGE_LABEL } from "./lib/pretext-measure.js";
import type { GraphSearchState, SceneEdge } from "./projection-types.js";
import { graphLabelFingerprint, sceneEdgePairMergeKey } from "./projection-types.js";
import { useProjection } from "./use-projection.js";

const EDGE_LABEL_DISTANCE_FACTOR = 5;
const PICK_RADIUS = 0.028;

/**
 * `all`: draw inactive edges faintly.
 * `activeOnly`: no edges until subgraph focus (hover, pin, or search hits); then only edges that
 * are lit (inside the active subgraph and passing search dimming).
 */
export type GraphEdgeRenderMode = "all" | "activeOnly";
/** Matches drei dashed-line examples (`dashOffset` scroll). */
const DASH_SCROLL_SPEED = 10;

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

export function GraphEdgeLines({
  edges,
  posMap,
  activeSubgraphKeys,
  graphSearch,
  edgeRenderMode = "all",
}: {
  edges: SceneEdge[];
  posMap: Map<string, [number, number, number]>;
  /** When non-null, only edges with both endpoints in this set are fully lit. */
  activeSubgraphKeys: ReadonlySet<string> | null;
  graphSearch: GraphSearchState | null;
  edgeRenderMode?: GraphEdgeRenderMode;
}) {
  const { hasGraphSubgraphFocus, hasGraphSubgraphStrongFocus } = useProjection();

  if (edgeRenderMode === "activeOnly" && !hasGraphSubgraphFocus) {
    return null;
  }

  return (
    <>
      {edges.map((e) => {
        const from = posMap.get(e.fromKey);
        const to = posMap.get(e.toKey);
        if (!from || !to) return null;

        const searchLit =
          graphSearch === null ||
          hasGraphSubgraphStrongFocus ||
          (graphSearch.relevantKeys.has(e.fromKey) && graphSearch.relevantKeys.has(e.toKey));
        const subgraphLit =
          activeSubgraphKeys === null
            ? !hasGraphSubgraphFocus
            : activeSubgraphKeys.has(e.fromKey) && activeSubgraphKeys.has(e.toKey);
        const lit = searchLit && subgraphLit;

        if (edgeRenderMode === "activeOnly" && !lit) return null;

        const opacity = lit ? 0.5 : 0.07;
        const inPinnedSubgraph = !!(
          hasGraphSubgraphStrongFocus &&
          activeSubgraphKeys?.has(e.fromKey) &&
          activeSubgraphKeys.has(e.toKey)
        );
        const animateDash = inPinnedSubgraph && !!e.directed;

        return (
          <group key={e.key}>
            <GraphDashedEdgeLine from={from} to={to} opacity={opacity} animateDash={animateDash} />
            <EdgePickCylinder edge={e} from={from} to={to} />
          </group>
        );
      })}
    </>
  );
}

/** Same delimiter as node label tooltips (`marker.tsx`). */
const EDGE_LABEL_KINDS_DELIM = " • ";

function edgeLabelText(fromKey: string, toKey: string, labels: SceneEdge["labels"]): string {
  return labels.length > 0
    ? labels.map((l) => l.kind).join(EDGE_LABEL_KINDS_DELIM)
    : `${fromKey} ↔ ${toKey}`;
}

/** Snippets for parallel edges on one segment: concatenate distinct texts (search ranks one edge per hit row). */
function mergedEdgeSearchSnippets(
  edgeIds: readonly string[],
  hitSnippetByEdgeId: ReadonlyMap<string, string> | undefined,
): string | undefined {
  if (!hitSnippetByEdgeId?.size) return undefined;
  const parts: string[] = [];
  for (const id of edgeIds) {
    const s = hitSnippetByEdgeId.get(id)?.trim();
    if (s) parts.push(s);
  }
  if (parts.length === 0) return undefined;
  return parts.join("\n—\n");
}

/** Edge midpoint labels when an ego subgraph is active — one pill per geometric segment; multiple API edges / kinds merged like node tooltips. */
export function ActiveSubgraphEdgeLabels({
  edges,
  posMap,
  activeSubgraphKeys,
  edgeSearchHitPreviews = true,
  hitSnippetByEdgeId,
}: {
  edges: SceneEdge[];
  posMap: Map<string, [number, number, number]>;
  activeSubgraphKeys: ReadonlySet<string> | null;
  edgeSearchHitPreviews?: boolean;
  hitSnippetByEdgeId?: ReadonlyMap<string, string>;
}) {
  const mergedSegments = useMemo(() => {
    if (!activeSubgraphKeys) return [];
    const groups = new Map<
      string,
      {
        fromKey: string;
        toKey: string;
        labels: Map<string, SceneEdge["labels"][number]>;
        edgeIds: Set<string>;
      }
    >();

    for (const e of edges) {
      if (!activeSubgraphKeys.has(e.fromKey) || !activeSubgraphKeys.has(e.toKey)) continue;
      const ck = sceneEdgePairMergeKey(e);
      let g = groups.get(ck);
      if (!g) {
        const lm = new Map<string, SceneEdge["labels"][number]>();
        for (const lb of e.labels) lm.set(graphLabelFingerprint(lb), lb);
        g = { fromKey: e.fromKey, toKey: e.toKey, labels: lm, edgeIds: new Set([e.edgeId]) };
        groups.set(ck, g);
      } else {
        for (const lb of e.labels) g.labels.set(graphLabelFingerprint(lb), lb);
        g.edgeIds.add(e.edgeId);
      }
    }

    return [...groups.entries()].map(([segmentKey, g]) => ({
      segmentKey,
      fromKey: g.fromKey,
      toKey: g.toKey,
      labels: [...g.labels.values()],
      edgeIds: [...g.edgeIds],
    }));
  }, [edges, activeSubgraphKeys]);

  if (!activeSubgraphKeys) return null;

  return (
    <>
      {mergedSegments.map(({ segmentKey, fromKey, toKey, labels, edgeIds }) => {
        const from = posMap.get(fromKey);
        const to = posMap.get(toKey);
        if (!from || !to) return null;

        const text = edgeLabelText(fromKey, toKey, labels);
        const snippet =
          edgeSearchHitPreviews && hitSnippetByEdgeId?.size
            ? mergedEdgeSearchSnippets(edgeIds, hitSnippetByEdgeId)
            : undefined;
        const mx = (from[0] + to[0]) / 2;
        const my = (from[1] + to[1]) / 2;
        const mz = (from[2] + to[2]) / 2;

        return (
          <group key={`lbl-${segmentKey}`} position={[mx, my, mz]}>
            <Html
              center
              distanceFactor={EDGE_LABEL_DISTANCE_FACTOR}
              style={{ pointerEvents: snippet ? "auto" : "none" }}
            >
              <span className="inline-block rounded bg-background/90 px-1.5 py-0.5 text-foreground shadow-sm ring-1 ring-border/60">
                <MeasuredText
                  text={text}
                  font={FONT_EDGE_LABEL}
                  lineHeight={12}
                  maxWidth={280}
                  maxLines={snippet ? 2 : 1}
                  whiteSpace="normal"
                  className={snippet ? "text-left" : "text-center"}
                />
                {snippet ? (
                  <span className="mt-1 block border-t border-border/50 pt-1">
                    <MeasuredText
                      text={snippet}
                      font={FONT_EDGE_BODY}
                      lineHeight={14}
                      maxWidth={320}
                      maxLines={4}
                      whiteSpace="pre-wrap"
                      className="text-left text-[10px] leading-snug"
                    />
                  </span>
                ) : null}
              </span>
            </Html>
          </group>
        );
      })}
    </>
  );
}
