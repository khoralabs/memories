import {
  type ComponentProps,
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { EdgeBillboardProvenance } from "@/components/memories/edge-billboard-provenance";
import type { EdgePreviewJson } from "@/components/memories/memories-client";
import { useMemoriesClient } from "@/components/memories/memories-client-provider";
import { MemoryMetadata } from "@/components/memories/memory-metadata";
import {
  type GraphOntologyLabelMap,
  graphLabelFingerprint,
  type TypedGraphLabelInstance,
  type TypedSceneEdge,
} from "@/components/memories/projection-types";
import { useProjection } from "@/components/memories/use-projection";
import { useEdgeDetail } from "@/hooks/use-edge-detail";
import { cn } from "@/lib/utils";

type EdgeBillboardContextValue = {
  edge: TypedSceneEdge;
  loading: boolean;
  detail: EdgePreviewJson | null;
  ontologyLabels: TypedGraphLabelInstance<GraphOntologyLabelMap>[];
  properties: Record<string, unknown> | null;
  namespace: string;
};

const EdgeBillboardContext = createContext<EdgeBillboardContextValue | null>(null);

export function useEdgeBillboard<TEdge extends GraphOntologyLabelMap = GraphOntologyLabelMap>(): {
  edge: TypedSceneEdge<TEdge>;
  loading: boolean;
  detail: EdgePreviewJson | null;
  ontologyLabels: TypedGraphLabelInstance<TEdge>[];
  properties: Record<string, unknown> | null;
  namespace: string;
} {
  const ctx = useContext(EdgeBillboardContext);
  if (ctx == null) {
    throw new Error("useEdgeBillboard must be used within EdgeBillboard");
  }
  return ctx as {
    edge: TypedSceneEdge<TEdge>;
    loading: boolean;
    detail: EdgePreviewJson | null;
    ontologyLabels: TypedGraphLabelInstance<TEdge>[];
    properties: Record<string, unknown> | null;
    namespace: string;
  };
}

export type EdgeBillboardProps<TEdge extends GraphOntologyLabelMap = GraphOntologyLabelMap> = {
  edge: TypedSceneEdge<TEdge>;
  open: boolean;
  className?: string;
  provenanceTimeline?: boolean;
  children?: ReactNode | ((edge: TypedSceneEdge<TEdge>) => ReactNode);
};

/**
 * Compound edge preview. Default Labels render ontology **kinds only**;
 * freeform edge `properties` belong in {@link EdgeBillboard.Metadata}
 * (not ontology label `props`).
 */
function EdgeBillboardRoot<TEdge extends GraphOntologyLabelMap = GraphOntologyLabelMap>({
  edge,
  open,
  className,
  provenanceTimeline = false,
  children,
}: EdgeBillboardProps<TEdge>) {
  const { namespace, onMemoryPreviewPointerEnter, onMemoryPreviewPointerLeave } = useProjection();
  const client = useMemoriesClient();
  const useDetail = provenanceTimeline;
  const edgeDetail = useEdgeDetail({
    namespace,
    edgeId: edge.edgeId,
    open: open && useDetail,
  });

  const [detail, setDetail] = useState<EdgePreviewJson | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || useDetail) {
      setDetail(null);
      setLoading(false);
      return;
    }
    const ac = new AbortController();
    setLoading(true);
    setDetail(null);
    void client
      .getEdgePreview({
        namespace,
        edgeId: edge.edgeId,
        signal: ac.signal,
      })
      .then((json) => {
        if (!ac.signal.aborted) setDetail(json);
      })
      .catch(() => {
        if (!ac.signal.aborted) setDetail(null);
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, [open, useDetail, client, namespace, edge.edgeId]);

  const resolvedDetail = useDetail ? (edgeDetail.detail?.preview ?? null) : detail;
  const resolvedLoading = useDetail ? edgeDetail.loading : loading;

  const ontologyLabels = useMemo(() => {
    const m = new Map<string, TypedGraphLabelInstance<GraphOntologyLabelMap>>();
    for (const lb of edge.labels) {
      m.set(graphLabelFingerprint(lb), lb);
    }
    if (resolvedDetail?.labels) {
      for (const lb of resolvedDetail.labels) {
        m.set(graphLabelFingerprint(lb), lb);
      }
    }
    return [...m.values()].sort((a, b) => a.kind.localeCompare(b.kind));
  }, [edge.labels, resolvedDetail?.labels]);

  if (!open) return null;

  const properties =
    resolvedDetail?.properties && Object.keys(resolvedDetail.properties).length > 0
      ? resolvedDetail.properties
      : null;

  const value: EdgeBillboardContextValue = {
    edge,
    loading: resolvedLoading,
    detail: resolvedDetail,
    ontologyLabels,
    properties,
    namespace,
  };

  const body =
    typeof children === "function"
      ? children(edge)
      : (children ?? (
          <>
            <EdgeBillboardHeader />
            <div className="max-h-[min(28vh,240px)] space-y-3 overflow-y-auto">
              <EdgeBillboardLoading />
              <EdgeBillboardLabels />
              <EdgeBillboardMetadata />
              {useDetail ? (
                <EdgeBillboardProvenance
                  edgeDetail={edgeDetail}
                  namespace={namespace}
                  edgeId={edge.edgeId}
                />
              ) : null}
            </div>
          </>
        ));

  return (
    <EdgeBillboardContext.Provider value={value}>
      <section
        aria-label="Edge preview"
        className={cn("flex max-h-[min(50vh,420px)] w-full flex-col gap-2 text-left", className)}
        onPointerEnter={onMemoryPreviewPointerEnter}
        onPointerLeave={onMemoryPreviewPointerLeave}
      >
        {body}
      </section>
    </EdgeBillboardContext.Provider>
  );
}

export type EdgeBillboardHeaderProps = ComponentProps<"div">;

export function EdgeBillboardHeader({ className, children, ...props }: EdgeBillboardHeaderProps) {
  const { edge } = useEdgeBillboard();
  return (
    <div
      className={cn(
        "font-mono text-[10px] font-normal leading-tight text-muted-foreground",
        className,
      )}
      {...props}
    >
      {children ?? (
        <>
          <span className="text-foreground">{edge.fromKey}</span>
          <span className="text-muted-foreground"> ↔ </span>
          <span className="text-foreground">{edge.toKey}</span>
        </>
      )}
    </div>
  );
}

export type EdgeBillboardLoadingProps = ComponentProps<"span">;

export function EdgeBillboardLoading({ className, children, ...props }: EdgeBillboardLoadingProps) {
  const { loading } = useEdgeBillboard();
  if (!loading) return null;
  return (
    <span className={cn("font-mono text-[10px] text-muted-foreground", className)} {...props}>
      {children ?? "Loading edge detail…"}
    </span>
  );
}

export type EdgeBillboardLabelsCtx = {
  labels: TypedGraphLabelInstance<GraphOntologyLabelMap>[];
  loading: boolean;
};

export type EdgeBillboardLabelsProps = Omit<ComponentProps<"ul">, "children"> & {
  /**
   * Default: ontology **kinds only**. Function children receive full label objects
   * (including ontology `props`) for custom rows; still wrapped in `<ul>`.
   */
  children?: ReactNode | ((ctx: EdgeBillboardLabelsCtx) => ReactNode);
};

export function EdgeBillboardLabels({ className, children, ...props }: EdgeBillboardLabelsProps) {
  const { ontologyLabels, loading } = useEdgeBillboard();
  const ctx: EdgeBillboardLabelsCtx = { labels: ontologyLabels, loading };

  if (typeof children === "function") {
    return (
      <ul
        className={cn(
          "list-inside list-disc space-y-1 font-mono text-xs text-foreground",
          className,
        )}
        {...props}
      >
        {children(ctx)}
      </ul>
    );
  }

  if (children !== undefined) {
    return (
      <ul
        className={cn(
          "list-inside list-disc space-y-1 font-mono text-xs text-foreground",
          className,
        )}
        {...props}
      >
        {children}
      </ul>
    );
  }

  if (ontologyLabels.length > 0) {
    return (
      <ul
        className={cn(
          "list-inside list-disc space-y-1 font-mono text-xs text-foreground",
          className,
        )}
        {...props}
      >
        {ontologyLabels.map((lb) => (
          <li key={graphLabelFingerprint(lb)} className="break-words">
            <span className="font-medium">{lb.kind}</span>
          </li>
        ))}
      </ul>
    );
  }

  if (loading) return null;
  return <span className="text-muted-foreground text-xs">No ontology labels on this edge.</span>;
}

export type EdgeBillboardMetadataCtx = {
  properties: Record<string, unknown> | null;
  loading: boolean;
};

export type EdgeBillboardMetadataProps = Omit<ComponentProps<"div">, "children"> & {
  /** Freeform edge properties (not ontology label props). */
  children?: ReactNode | ((ctx: EdgeBillboardMetadataCtx) => ReactNode);
};

export function EdgeBillboardMetadata({
  className,
  children,
  ...props
}: EdgeBillboardMetadataProps) {
  const { edge, properties, loading, namespace, ontologyLabels } = useEdgeBillboard();
  const ctx: EdgeBillboardMetadataCtx = { properties, loading };

  if (typeof children === "function") {
    return (
      <div className={cn("space-y-1 border-t border-border/60 pt-2", className)} {...props}>
        {children(ctx)}
      </div>
    );
  }

  if (children !== undefined) {
    return (
      <div className={cn("space-y-1 border-t border-border/60 pt-2", className)} {...props}>
        {children}
      </div>
    );
  }

  if (properties == null) return null;

  return (
    <div className={cn(className)} {...props}>
      <MemoryMetadata
        kind="edge"
        memoryKey={edge.edgeId}
        namespace={namespace}
        labelKinds={ontologyLabels.map((lb) => lb.kind)}
        properties={properties}
        showList
        className="border-t border-border/60 pt-2"
      />
    </div>
  );
}

export const EdgeBillboard = Object.assign(EdgeBillboardRoot, {
  Header: EdgeBillboardHeader,
  Labels: EdgeBillboardLabels,
  Metadata: EdgeBillboardMetadata,
  Loading: EdgeBillboardLoading,
});
