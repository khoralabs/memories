import { cn } from "@/lib/utils";

export type MemoryLabel = {
  kind: string;
  props: Record<string, unknown>;
};

/** Display node ontology kinds in PascalCase (`person`, `some_fact` → `SomeFact`). */
export function formatNodeLabelKind(kind: string): string {
  const parts = kind
    .trim()
    .split(/[_\s-]+/)
    .filter((p) => p.length > 0);
  if (parts.length === 0) return kind.trim();
  return parts
    .map((part) => {
      const lower = part.toLowerCase();
      return `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`;
    })
    .join("");
}

/** Display edge ontology kinds in UPPERCASE (`references` → `REFERENCES`). */
export function formatEdgeLabelKind(kind: string): string {
  return kind
    .trim()
    .replace(/[_\s-]+/g, "_")
    .toUpperCase();
}

export function formatOntologyLabelKind(kind: string, variant: "node" | "edge"): string {
  return variant === "edge" ? formatEdgeLabelKind(kind) : formatNodeLabelKind(kind);
}

/** Join ontology kinds as a Cypher-style chain (`Person:Event`, `INCLUDES:RELATED_TO`). */
export function formatOntologyLabelChain(
  kinds: readonly string[],
  variant: "node" | "edge",
): string {
  return kinds
    .map((k) => k.trim())
    .filter((k) => k.length > 0)
    .map((k) => formatOntologyLabelKind(k, variant))
    .join(":");
}

function isShallowProps(props: Record<string, unknown>): boolean {
  return Object.values(props).every(
    (v) => v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean",
  );
}

function formatPropValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return value.length > 0 ? value : '""';
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

export function MemoryDetailOntology({
  labels,
  variant,
  className,
  compact = false,
}: {
  labels: MemoryLabel[];
  variant: "node" | "edge";
  className?: string;
  /** Tighter spacing for billboards / dense panels. */
  compact?: boolean;
}) {
  if (labels.length === 0) {
    return (
      <p className={compact ? "text-xs text-muted-foreground" : "text-sm text-muted-foreground"}>
        No ontology labels.
      </p>
    );
  }

  return (
    <ul className={cn(compact ? "space-y-2" : "space-y-4", className)}>
      {labels.map((lb) => {
        const props =
          lb.props !== null && typeof lb.props === "object" && !Array.isArray(lb.props)
            ? lb.props
            : {};
        const keys = Object.keys(props);
        const shallow = isShallowProps(props);
        const kindLabel = formatOntologyLabelKind(lb.kind, variant);
        return (
          <li
            key={`${lb.kind}:${JSON.stringify(props)}`}
            className={compact ? "space-y-1" : "space-y-2"}
          >
            <p
              className={
                variant === "edge"
                  ? cn("font-medium tracking-wide uppercase", compact ? "text-xs" : "text-sm")
                  : cn("font-medium", compact ? "text-xs" : "text-sm")
              }
            >
              {kindLabel}
            </p>
            {keys.length === 0 ? (
              <p className="text-xs text-muted-foreground">No properties</p>
            ) : shallow ? (
              <dl className="grid gap-x-3 gap-y-1 sm:grid-cols-[7rem_minmax(0,1fr)]">
                {keys.map((key) => (
                  <div key={key} className="contents">
                    <dt className="font-mono text-[11px] text-muted-foreground">{key}</dt>
                    <dd className="min-w-0 text-xs break-words">{formatPropValue(props[key])}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-muted-foreground">
                {JSON.stringify(props, null, 2)}
              </pre>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function primaryLabelKind(labels: MemoryLabel[] | undefined | null): string | null {
  const kind = labels?.[0]?.kind?.trim() ?? "";
  return kind.length > 0 ? kind : null;
}

export function primaryFormattedLabelKind(
  labels: MemoryLabel[] | undefined | null,
  variant: "node" | "edge",
): string | null {
  const kind = primaryLabelKind(labels);
  return kind !== null ? formatOntologyLabelKind(kind, variant) : null;
}
