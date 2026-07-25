import { Html } from "@react-three/drei";
import { useMemo } from "react";
import { MeasuredText } from "./components/measured-text.js";
import { FONT_EDGE_BODY, FONT_EDGE_LABEL } from "./lib/pretext-measure.js";
import type { SceneEdge } from "./projection-types.js";
import { graphLabelFingerprint, sceneEdgePairMergeKey } from "./projection-types.js";

const EDGE_LABEL_DISTANCE_FACTOR = 5;

/**
 * `all`: draw inactive edges faintly.
 * `activeOnly`: no edges until subgraph focus (hover, pin, or search hits); then only edges that
 * are lit (inside the active subgraph and passing search dimming).
 */
export type GraphEdgeRenderMode = "all" | "activeOnly";

/** Same delimiter as node label tooltips. */
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
