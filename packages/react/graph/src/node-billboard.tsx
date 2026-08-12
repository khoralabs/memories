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
import type { MemoryPreviewJson } from "./memories-client.js";
import { useMemoriesClient } from "./memories-client-provider.js";
import { MemoryMetadata } from "./memory-metadata.js";
import {
  type GraphOntologyLabelMap,
  graphLabelFingerprint,
  type TypedGraphLabelInstance,
  type TypedProjectionPoint,
} from "./projection-types.js";
import { useProjection } from "./use-projection.js";

type NodeBillboardContextValue = {
  point: TypedProjectionPoint;
  loading: boolean;
  detail: MemoryPreviewJson | null;
  ontologyLabels: TypedGraphLabelInstance<GraphOntologyLabelMap>[];
  properties: Record<string, unknown> | null;
  namespace: string;
};

const NodeBillboardContext = createContext<NodeBillboardContextValue | null>(null);

export function useNodeBillboard<TNode extends GraphOntologyLabelMap = GraphOntologyLabelMap>(): {
  point: TypedProjectionPoint<TNode>;
  loading: boolean;
  detail: MemoryPreviewJson | null;
  ontologyLabels: TypedGraphLabelInstance<TNode>[];
  properties: Record<string, unknown> | null;
  namespace: string;
} {
  const ctx = useContext(NodeBillboardContext);
  if (ctx == null) {
    throw new Error("useNodeBillboard must be used within NodeBillboard");
  }
  return ctx as {
    point: TypedProjectionPoint<TNode>;
    loading: boolean;
    detail: MemoryPreviewJson | null;
    ontologyLabels: TypedGraphLabelInstance<TNode>[];
    properties: Record<string, unknown> | null;
    namespace: string;
  };
}

export type NodeBillboardProps<TNode extends GraphOntologyLabelMap = GraphOntologyLabelMap> = {
  point: TypedProjectionPoint<TNode>;
  open: boolean;
  className?: string;
  /**
   * When set, skip preview fetch and use these freeform node properties
   * (`nodes.properties`). Pass `null` for “loaded, empty”.
   */
  properties?: Record<string, unknown> | null;
  children?: ReactNode | ((node: TypedProjectionPoint<TNode>) => ReactNode);
};

/**
 * Compound node preview. Default Labels render ontology **kinds only**;
 * freeform `nodes.properties` belong in {@link NodeBillboard.Metadata}
 * (not ontology label `props`).
 */
function NodeBillboardRoot<TNode extends GraphOntologyLabelMap = GraphOntologyLabelMap>({
  point,
  open,
  className,
  properties: propertiesProp,
  children,
}: NodeBillboardProps<TNode>) {
  const { namespace, onMemoryPreviewPointerEnter, onMemoryPreviewPointerLeave } = useProjection();
  const client = useMemoriesClient();
  const injectProperties = propertiesProp !== undefined;

  const [detail, setDetail] = useState<MemoryPreviewJson | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || injectProperties) {
      setDetail(null);
      setLoading(false);
      return;
    }
    const ac = new AbortController();
    setLoading(true);
    setDetail(null);
    void client
      .getMemoryPreview({
        namespace,
        key: point.key,
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
  }, [open, injectProperties, client, namespace, point.key]);

  const ontologyLabels = useMemo(() => {
    const m = new Map<string, TypedGraphLabelInstance<GraphOntologyLabelMap>>();
    for (const lb of point.labels) {
      m.set(graphLabelFingerprint(lb), lb);
    }
    if (detail?.labels) {
      for (const lb of detail.labels) {
        m.set(graphLabelFingerprint(lb), lb);
      }
    }
    return [...m.values()].sort((a, b) => a.kind.localeCompare(b.kind));
  }, [point.labels, detail?.labels]);

  if (!open) return null;

  const fetchedProperties =
    detail?.properties && Object.keys(detail.properties).length > 0 ? detail.properties : null;
  const properties = injectProperties
    ? propertiesProp && Object.keys(propertiesProp).length > 0
      ? propertiesProp
      : null
    : fetchedProperties;

  const value: NodeBillboardContextValue = {
    point,
    loading: injectProperties ? false : loading,
    detail,
    ontologyLabels,
    properties,
    namespace,
  };

  const body =
    typeof children === "function"
      ? children(point)
      : (children ?? (
          <>
            <NodeBillboardHeader />
            <div className="max-h-[min(28vh,240px)] space-y-3 overflow-y-auto">
              <NodeBillboardLoading />
              <NodeBillboardLabels />
              <NodeBillboardMetadata />
            </div>
          </>
        ));

  return (
    <NodeBillboardContext.Provider value={value}>
      <section
        aria-label="Memory preview"
        className={cn("flex max-h-[min(50vh,420px)] w-full flex-col gap-2 text-left", className)}
        onPointerEnter={onMemoryPreviewPointerEnter}
        onPointerLeave={onMemoryPreviewPointerLeave}
      >
        {body}
      </section>
    </NodeBillboardContext.Provider>
  );
}

export type NodeBillboardHeaderProps = ComponentProps<"div">;

export function NodeBillboardHeader({ className, children, ...props }: NodeBillboardHeaderProps) {
  const { point, namespace } = useNodeBillboard();
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
          {namespace} <span className="text-foreground">·</span>{" "}
          <span className="text-foreground">{point.entryId}</span>
        </>
      )}
    </div>
  );
}

export type NodeBillboardLoadingProps = ComponentProps<"span">;

export function NodeBillboardLoading({ className, children, ...props }: NodeBillboardLoadingProps) {
  const { loading } = useNodeBillboard();
  if (!loading) return null;
  return (
    <span className={cn("font-mono text-[10px] text-muted-foreground", className)} {...props}>
      {children ?? "Loading memory detail…"}
    </span>
  );
}

export type NodeBillboardLabelsCtx = {
  labels: TypedGraphLabelInstance<GraphOntologyLabelMap>[];
  loading: boolean;
};

export type NodeBillboardLabelsProps = Omit<ComponentProps<"ul">, "children"> & {
  /**
   * Default: ontology **kinds only**. Function children receive full label objects
   * (including ontology `props`) for custom rows; still wrapped in `<ul>`.
   */
  children?: ReactNode | ((ctx: NodeBillboardLabelsCtx) => ReactNode);
};

export function NodeBillboardLabels({ className, children, ...props }: NodeBillboardLabelsProps) {
  const { ontologyLabels, loading } = useNodeBillboard();
  const ctx: NodeBillboardLabelsCtx = { labels: ontologyLabels, loading };

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
  return <span className="text-muted-foreground text-xs">No ontology labels on this node.</span>;
}

export type NodeBillboardMetadataCtx = {
  properties: Record<string, unknown> | null;
  loading: boolean;
};

export type NodeBillboardMetadataProps = Omit<ComponentProps<"div">, "children"> & {
  /** Freeform `nodes.properties` (not ontology label props). */
  children?: ReactNode | ((ctx: NodeBillboardMetadataCtx) => ReactNode);
};

export function NodeBillboardMetadata({
  className,
  children,
  ...props
}: NodeBillboardMetadataProps) {
  const { point, properties, loading, namespace, ontologyLabels } = useNodeBillboard();
  const ctx: NodeBillboardMetadataCtx = { properties, loading };

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
        kind="node"
        memoryKey={point.key}
        namespace={namespace}
        labelKinds={ontologyLabels.map((lb) => lb.kind)}
        properties={properties}
        showList
        className="border-t border-border/60 pt-2"
      />
    </div>
  );
}

export const NodeBillboard = Object.assign(NodeBillboardRoot, {
  Header: NodeBillboardHeader,
  Labels: NodeBillboardLabels,
  Metadata: NodeBillboardMetadata,
  Loading: NodeBillboardLoading,
});
