import {
  type ComponentProps,
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { cn } from "@/lib/utils";
import type { EdgePreviewJson } from "./memories-client.js";
import { useMemoriesClient } from "./memories-client-provider.js";
import {
  type GraphOntologyLabelMap,
  graphLabelFingerprint,
  type TypedGraphLabelInstance,
  type TypedSceneEdge,
} from "./projection-types.js";
import { useProjection } from "./use-projection.js";

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
  children?: ReactNode | ((edge: TypedSceneEdge<TEdge>) => ReactNode);
};

function EdgeBillboardRoot<TEdge extends GraphOntologyLabelMap = GraphOntologyLabelMap>({
  edge,
  open,
  className,
  children,
}: EdgeBillboardProps<TEdge>) {
  const { namespace, onMemoryPreviewPointerEnter, onMemoryPreviewPointerLeave } = useProjection();
  const client = useMemoriesClient();

  const [detail, setDetail] = useState<EdgePreviewJson | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) {
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
  }, [open, client, namespace, edge.edgeId]);

  const ontologyLabels = useMemo(() => {
    const m = new Map<string, TypedGraphLabelInstance<GraphOntologyLabelMap>>();
    for (const lb of edge.labels) {
      m.set(graphLabelFingerprint(lb), lb);
    }
    if (detail?.labels) {
      for (const lb of detail.labels) {
        m.set(graphLabelFingerprint(lb), lb);
      }
    }
    return [...m.values()].sort((a, b) => a.kind.localeCompare(b.kind));
  }, [edge.labels, detail?.labels]);

  if (!open) return null;

  const properties =
    detail?.properties && Object.keys(detail.properties).length > 0 ? detail.properties : null;

  const value: EdgeBillboardContextValue = {
    edge,
    loading,
    detail,
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

export type EdgeBillboardLabelsProps = ComponentProps<"ul">;

export function EdgeBillboardLabels({ className, children, ...props }: EdgeBillboardLabelsProps) {
  const { ontologyLabels, loading } = useEdgeBillboard();

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
            {Object.keys(lb.props).length > 0 ? (
              <span className="text-muted-foreground"> {JSON.stringify(lb.props)}</span>
            ) : null}
          </li>
        ))}
      </ul>
    );
  }

  if (loading) return null;
  return <span className="text-muted-foreground text-xs">No ontology labels on this edge.</span>;
}

export type EdgeBillboardMetadataProps = ComponentProps<"div">;

export function EdgeBillboardMetadata({
  className,
  children,
  ...props
}: EdgeBillboardMetadataProps) {
  const { properties } = useEdgeBillboard();
  if (properties == null) return null;

  const propsEntries = Object.entries(properties);

  return (
    <div className={cn("space-y-1 border-t border-border/60 pt-2", className)} {...props}>
      {children ?? (
        <>
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Edge metadata
          </div>
          <dl className="space-y-1 font-mono text-[11px] text-foreground">
            {propsEntries.map(([k, v]) => (
              <div key={k} className="grid gap-0.5">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="break-all pl-1">
                  {typeof v === "object" ? JSON.stringify(v) : String(v)}
                </dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </div>
  );
}

export const EdgeBillboard = Object.assign(EdgeBillboardRoot, {
  Header: EdgeBillboardHeader,
  Labels: EdgeBillboardLabels,
  Metadata: EdgeBillboardMetadata,
  Loading: EdgeBillboardLoading,
});

/** @deprecated Prefer {@link EdgeBillboard}. */
export function EdgePreviewCard(props: EdgeBillboardProps) {
  return <EdgeBillboard {...props} />;
}
