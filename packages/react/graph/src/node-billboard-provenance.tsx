import { AtTipPanel, ProvenanceTimeline } from "./provenance-timeline.js";
import type { useMemoryDetail } from "./use-memory-detail.js";

export function NodeBillboardProvenance({
  memoryDetail,
  namespace,
  memoryKey,
}: {
  memoryDetail: ReturnType<typeof useMemoryDetail>;
  namespace: string;
  memoryKey: string;
}) {
  const atTip = memoryDetail.detail?.atTip;

  return (
    <>
      <ProvenanceTimeline
        namespace={namespace}
        memoryKey={memoryKey}
        rootHex={memoryDetail.detail?.rootHex}
        selectedRootHex={memoryDetail.rootHex}
        onSelectRootHex={(hex) => memoryDetail.setRootHex(hex)}
      />
      <AtTipPanel
        content={atTip?.content?.content ?? null}
        graphAvailable={memoryDetail.tipReplayAtRootHex}
        graph={(atTip?.graph?.graph as Record<string, unknown> | null) ?? null}
        vectorCount={atTip?.vectors?.vectors.length ?? null}
      />
    </>
  );
}
