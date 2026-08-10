import { cn } from "@/lib/utils";

export type MemoryMetadataKind = "node" | "edge";

function metaContent(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export type MemoryMetadataProps = {
  kind: MemoryMetadataKind;
  memoryKey: string;
  namespace: string;
  suppressed?: boolean;
  /** Ontology label kinds (emitted as `memory:label`). */
  labelKinds?: readonly string[];
  /** Freeform properties (`memory:property:*` meta + optional visible list). */
  properties?: Record<string, unknown> | null;
  /** Max freeform properties in the visible list. Default unlimited. */
  maxVisible?: number;
  /**
   * Visible list heading. Pass `null` to show the list without a heading.
   * Ignored when `showList` is false.
   */
  heading?: string | null;
  /** Show the visible key/value list (default true). */
  showList?: boolean;
  /** Emit `<meta>` tags (default true). Set false when a parent already emitted them. */
  emitMeta?: boolean;
  className?: string;
  emptyLabel?: string;
};

/**
 * Shared node/edge metadata: machine-readable `<meta>` tags plus an optional
 * visible key/value list (billboards, detail overviews).
 */
export function MemoryMetadata({
  kind,
  memoryKey,
  namespace,
  suppressed,
  labelKinds,
  properties,
  maxVisible,
  heading,
  showList = true,
  emitMeta = true,
  className,
  emptyLabel,
}: MemoryMetadataProps) {
  const key = memoryKey.trim();
  const ns = namespace.trim();
  const kinds = (labelKinds ?? []).map((k) => k.trim()).filter((k) => k.length > 0);
  const entries =
    properties == null ? [] : Object.entries(properties).filter(([name]) => name.trim().length > 0);
  const visibleCap = maxVisible === undefined ? entries.length : Math.max(0, maxVisible);
  const visible = entries.slice(0, visibleCap);
  const truncated = entries.length > visible.length;
  const title =
    heading === undefined ? (kind === "edge" ? "Edge metadata" : "Node metadata") : heading;
  const empty =
    emptyLabel ??
    (kind === "edge"
      ? "No freeform properties on this relation."
      : "No freeform properties on this node.");

  if (!emitMeta && !showList) return null;

  return (
    <div className={cn(showList ? "space-y-1" : "contents", className)}>
      {emitMeta ? (
        <>
          <meta name="memory:kind" content={kind} />
          {key.length > 0 ? <meta name="memory:key" content={key} /> : null}
          {ns.length > 0 ? <meta name="memory:namespace" content={ns} /> : null}
          {suppressed !== undefined ? (
            <meta name="memory:suppressed" content={suppressed ? "true" : "false"} />
          ) : null}
          {kinds.map((labelKind) => (
            <meta key={labelKind} name="memory:label" content={labelKind} />
          ))}
          {entries.map(([name, value]) => (
            <meta key={name} name={`memory:property:${name}`} content={metaContent(value)} />
          ))}
        </>
      ) : null}

      {showList ? (
        <>
          {title !== null ? (
            <div className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
              {title}
            </div>
          ) : null}
          {visible.length === 0 ? (
            <p className="text-xs text-muted-foreground">{empty}</p>
          ) : (
            <dl className="space-y-1 font-mono text-[11px] text-foreground">
              {visible.map(([name, value]) => (
                <div key={name} className="grid gap-0.5">
                  <dt className="text-muted-foreground">{name}</dt>
                  <dd className="break-all pl-1">{displayValue(value)}</dd>
                </div>
              ))}
              {truncated ? (
                <p className="text-xs text-muted-foreground">
                  Showing {visible.length} of {entries.length}.
                </p>
              ) : null}
            </dl>
          )}
        </>
      ) : null}
    </div>
  );
}
