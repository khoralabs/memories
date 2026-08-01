import { type ComponentProps, createContext, type ReactNode, useContext } from "react";
import { cn } from "@/lib/utils";
import {
  type GraphOntologyLabelMap,
  graphLabelFingerprint,
  type TypedProjectionPoint,
} from "./projection-types.js";
import { useProjection } from "./use-projection.js";

type NodeBillboardContextValue = {
  point: TypedProjectionPoint;
  namespace: string;
};

const NodeBillboardContext = createContext<NodeBillboardContextValue | null>(null);

export function useNodeBillboard<TNode extends GraphOntologyLabelMap = GraphOntologyLabelMap>(): {
  point: TypedProjectionPoint<TNode>;
  namespace: string;
} {
  const ctx = useContext(NodeBillboardContext);
  if (ctx == null) {
    throw new Error("useNodeBillboard must be used within NodeBillboard");
  }
  return ctx as { point: TypedProjectionPoint<TNode>; namespace: string };
}

export type NodeBillboardProps<TNode extends GraphOntologyLabelMap = GraphOntologyLabelMap> = {
  point: TypedProjectionPoint<TNode>;
  open: boolean;
  className?: string;
  children?: ReactNode | ((node: TypedProjectionPoint<TNode>) => ReactNode);
};

function NodeBillboardRoot<TNode extends GraphOntologyLabelMap = GraphOntologyLabelMap>({
  point,
  open,
  className,
  children,
}: NodeBillboardProps<TNode>) {
  const { namespace, onMemoryPreviewPointerEnter, onMemoryPreviewPointerLeave } = useProjection();

  if (!open) return null;

  const body =
    typeof children === "function"
      ? children(point)
      : (children ?? (
          <>
            <NodeBillboardHeader />
            <div className="max-h-[min(28vh,240px)] overflow-y-auto">
              <NodeBillboardLabels />
            </div>
          </>
        ));

  return (
    <NodeBillboardContext.Provider value={{ point, namespace }}>
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

export type NodeBillboardLabelsProps = ComponentProps<"ul">;

export function NodeBillboardLabels({ className, children, ...props }: NodeBillboardLabelsProps) {
  const { point } = useNodeBillboard();

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

  if (point.labels.length === 0) {
    return <span className="text-muted-foreground text-xs">No ontology labels on this node.</span>;
  }

  return (
    <ul
      className={cn("list-inside list-disc space-y-1 font-mono text-xs text-foreground", className)}
      {...props}
    >
      {point.labels.map((lb) => (
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

export const NodeBillboard = Object.assign(NodeBillboardRoot, {
  Header: NodeBillboardHeader,
  Labels: NodeBillboardLabels,
});

/** @deprecated Prefer {@link NodeBillboard}. */
export function NodePreviewCard(props: NodeBillboardProps) {
  return <NodeBillboard {...props} />;
}
