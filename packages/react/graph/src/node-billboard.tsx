import type { ProjectionPoint } from "./projection-types.js";
import { useProjection } from "./use-projection.js";

export function NodePreviewCard({ point, open }: { point: ProjectionPoint; open: boolean }) {
  const { namespace, onMemoryPreviewPointerEnter, onMemoryPreviewPointerLeave } = useProjection();

  if (!open) return null;

  return (
    <section
      aria-label="Memory preview"
      className="flex max-h-[min(50vh,420px)] w-full flex-col gap-2 text-left"
      onPointerEnter={onMemoryPreviewPointerEnter}
      onPointerLeave={onMemoryPreviewPointerLeave}
    >
      <div className="font-mono text-[10px] font-normal leading-tight text-muted-foreground">
        {namespace} <span className="text-foreground">·</span>{" "}
        <span className="text-foreground">{point.entryId}</span>
      </div>
      <div className="max-h-[min(28vh,240px)] overflow-y-auto">
        {point.labels.length > 0 ? (
          <ul className="list-inside list-disc space-y-1 font-mono text-xs text-foreground">
            {point.labels.map((lb) => (
              <li key={`${lb.kind}:${JSON.stringify(lb.props)}`} className="break-words">
                <span className="font-medium">{lb.kind}</span>
                {Object.keys(lb.props).length > 0 ? (
                  <span className="text-muted-foreground"> {JSON.stringify(lb.props)}</span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <span className="text-muted-foreground text-xs">No ontology labels on this node.</span>
        )}
      </div>
    </section>
  );
}
