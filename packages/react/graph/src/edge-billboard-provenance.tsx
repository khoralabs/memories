import { AtTipPanel, ProvenanceTimeline } from "./provenance-timeline.js";
import type { useEdgeDetail } from "./use-edge-detail.js";

export function EdgeBillboardProvenance({
  edgeDetail,
  namespace,
  edgeId,
}: {
  edgeDetail: ReturnType<typeof useEdgeDetail>;
  namespace: string;
  edgeId: string;
}) {
  const atTip = edgeDetail.detail?.atTip;

  return (
    <>
      <ProvenanceTimeline
        namespace={namespace}
        edgeId={edgeId}
        rootHex={edgeDetail.detail?.rootHex}
        selectedRootHex={edgeDetail.rootHex}
        onSelectRootHex={(hex) => edgeDetail.setRootHex(hex)}
      />
      <AtTipPanel
        content={atTip?.content?.content ?? null}
        graphAvailable={edgeDetail.tipReplayAtRootHex}
        graph={(atTip?.graph?.graph as Record<string, unknown> | null) ?? null}
        vectorCount={atTip?.vectors?.vectors.length ?? null}
      />
    </>
  );
}
