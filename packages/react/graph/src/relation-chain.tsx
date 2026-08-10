import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatOntologyLabelChain } from "./memory-detail-ontology.js";

/** Truncate a memory key for inline chain fallbacks. */
export function truncateRelationKey(key: string, max = 28): string {
  const trimmed = key.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}…`;
}

/** Node segment text: colon-joined labels, or truncated key when unlabeled. */
export function relationNodeSegmentText(labelKinds: readonly string[], memoryKey: string): string {
  const chain = formatOntologyLabelChain(labelKinds, "node");
  if (chain.length > 0) return chain;
  return truncateRelationKey(memoryKey) || "Node";
}

/** Edge segment text: colon-joined labels, or muted placeholder when unlabeled. */
export function relationEdgeSegmentText(labelKinds: readonly string[]): string {
  const chain = formatOntologyLabelChain(labelKinds, "edge");
  return chain.length > 0 ? chain : "—";
}

/** Static (non-link) edge label badge for the current edge page. */
export function RelationEdgeBadge({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <Badge
      variant="secondary"
      className={cn("max-w-full truncate tracking-wide uppercase", className)}
    >
      {children}
    </Badge>
  );
}

export function RelationChain({
  left,
  mid,
  right,
  className,
}: {
  left: ReactNode;
  mid: ReactNode;
  right: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-wrap items-center gap-1.5 text-xs", className)}>
      {left}
      <span className="text-muted-foreground" aria-hidden>
        →
      </span>
      {mid}
      <span className="text-muted-foreground" aria-hidden>
        →
      </span>
      {right}
    </div>
  );
}
