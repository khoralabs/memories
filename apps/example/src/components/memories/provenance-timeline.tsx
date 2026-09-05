import { useEffect, useState } from "react";
import { useMemoriesClient } from "@/components/memories/memories-client-provider";
import { cn } from "@/lib/utils";

export type ProvenanceTimelineProps = {
  namespace: string;
  memoryKey?: string;
  edgeId?: string;
  rootHex?: string;
  selectedRootHex?: string;
  onSelectRootHex: (rootHex: string) => void;
  className?: string;
  limit?: number;
};

/** Entity-scoped provenance tip scrubber (no styling polish). */
export function ProvenanceTimeline({
  namespace,
  memoryKey,
  edgeId,
  rootHex,
  selectedRootHex,
  onSelectRootHex,
  className,
  limit = 20,
}: ProvenanceTimelineProps) {
  const client = useMemoriesClient();
  const [links, setLinks] = useState<
    Array<{ rootHex: string; eventType: string; createdAt: number }>
  >([]);

  useEffect(() => {
    const ac = new AbortController();
    void client
      .listProvenanceEvents({
        namespace,
        ...(memoryKey !== undefined ? { key: memoryKey } : {}),
        ...(edgeId !== undefined ? { edgeId } : {}),
        limit,
        signal: ac.signal,
      })
      .then((rows) => {
        if (!ac.signal.aborted) {
          setLinks(
            rows.map((r) => ({
              rootHex: r.rootHex,
              eventType: r.eventType,
              createdAt: r.createdAt,
            })),
          );
        }
      })
      .catch(() => {
        if (!ac.signal.aborted) setLinks([]);
      });
    return () => ac.abort();
  }, [client, namespace, memoryKey, edgeId, limit]);

  if (links.length === 0) return null;

  const active = selectedRootHex ?? rootHex;

  return (
    <section className={cn("space-y-1", className)}>
      <div className="font-mono text-[10px] text-muted-foreground">Provenance</div>
      <ol className="max-h-24 space-y-0.5 overflow-y-auto font-mono text-[10px]">
        {links.map((link) => (
          <li key={link.rootHex}>
            <button
              type="button"
              className={cn(
                "w-full truncate text-left hover:text-foreground",
                active === link.rootHex ? "text-foreground" : "text-muted-foreground",
              )}
              onClick={() => onSelectRootHex(link.rootHex)}
            >
              {link.eventType} · {link.rootHex.slice(0, 8)}
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

export type AtTipPanelProps = {
  content: Array<{ sourceKey: string; text: string }> | null;
  graphAvailable: boolean;
  graph: Record<string, unknown> | null;
  vectorCount: number | null;
  className?: string;
};

export function AtTipPanel({
  content,
  graphAvailable,
  graph,
  vectorCount,
  className,
}: AtTipPanelProps) {
  if (content === null && graph === null && vectorCount === null && graphAvailable) {
    return null;
  }
  return (
    <section className={cn("space-y-2 border-t border-border pt-2", className)}>
      <div className="font-mono text-[10px] text-muted-foreground">At tip</div>
      {content !== null && content.length > 0 ? (
        <ul className="space-y-1 font-mono text-[10px] text-foreground">
          {content.map((arm) => (
            <li key={arm.sourceKey} className="break-words">
              <span className="text-muted-foreground">{arm.sourceKey}:</span> {arm.text}
            </li>
          ))}
        </ul>
      ) : null}
      {graphAvailable ? (
        graph !== null ? (
          <div className="font-mono text-[10px] text-muted-foreground">
            Graph snapshot ({String(graph.kind ?? "memory")})
          </div>
        ) : (
          <div className="font-mono text-[10px] text-muted-foreground">No graph at tip</div>
        )
      ) : (
        <div className="font-mono text-[10px] text-muted-foreground">
          Graph/vector history requires tipReplayAtRootHex
        </div>
      )}
      {graphAvailable && vectorCount !== null ? (
        <div className="font-mono text-[10px] text-muted-foreground">
          {vectorCount} vector arm{vectorCount === 1 ? "" : "s"} at tip
        </div>
      ) : null}
    </section>
  );
}
