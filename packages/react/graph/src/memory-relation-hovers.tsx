import { type MouseEvent, type ReactNode, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";
import type { EdgePreviewJson, ReactMemoriesClient } from "./memories-client.js";
import { formatOntologyLabelChain } from "./memory-detail-ontology.js";

const HOVER_MAX_CHARS = 280;

export type MemoryContentArm = {
  sourceKey: string;
  text: string | null;
};

export function firstContentExcerpt(
  content: MemoryContentArm[] | undefined,
  max = HOVER_MAX_CHARS,
): string | null {
  if (content === undefined) return null;
  for (const arm of content) {
    const text = arm.text?.trim() ?? "";
    if (text.length === 0) continue;
    if (text.length <= max) return text;
    return `${text.slice(0, max)}…`;
  }
  return null;
}

function navigateIfPlainClick(e: MouseEvent, href: string, navigate: (to: string) => void) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
    return;
  }
  e.preventDefault();
  navigate(href);
}

export function MemoryNodeHoverCard({
  client,
  namespace,
  memoryKey,
  href,
  navigate,
  labelKinds,
  prefetchedContent,
  className,
  children,
}: {
  client: ReactMemoriesClient;
  namespace: string;
  memoryKey: string;
  href?: string;
  /** When set with `href`, plain left-clicks call this instead of full navigation. */
  navigate?: (href: string) => void;
  labelKinds?: readonly string[];
  /** When set, skip the content fetch (still shows key immediately). */
  prefetchedContent?: MemoryContentArm[] | null;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [excerpt, setExcerpt] = useState<string | null>(() =>
    firstContentExcerpt(prefetchedContent ?? undefined),
  );
  const [fetched, setFetched] = useState(prefetchedContent !== undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setExcerpt(firstContentExcerpt(prefetchedContent ?? undefined));
    if (prefetchedContent !== undefined) setFetched(true);
  }, [prefetchedContent]);

  useEffect(() => {
    if (!open || fetched || namespace.length === 0 || memoryKey.trim().length === 0) {
      return;
    }
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    void client
      .getMemoryPreview({
        namespace,
        key: memoryKey,
        maxChars: HOVER_MAX_CHARS,
        signal: ac.signal,
      })
      .then((preview) => {
        if (ac.signal.aborted) return;
        setExcerpt(firstContentExcerpt(preview.content));
        setFetched(true);
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted) return;
        setError(err instanceof Error ? err.message : String(err));
        setFetched(true);
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, [open, fetched, client, namespace, memoryKey]);

  const labelsLine =
    labelKinds !== undefined && labelKinds.length > 0
      ? formatOntologyLabelChain(labelKinds, "node")
      : null;

  const badgeClassName = cn(
    "max-w-full truncate",
    href === undefined && "cursor-default",
    className,
  );

  return (
    <HoverCard open={open} onOpenChange={setOpen}>
      {href !== undefined ? (
        <HoverCardTrigger
          render={<Badge variant="outline" render={<a href={href} />} className={badgeClassName} />}
          onClick={
            navigate !== undefined ? (e) => navigateIfPlainClick(e, href, navigate) : undefined
          }
        >
          {children}
        </HoverCardTrigger>
      ) : (
        <HoverCardTrigger
          render={
            <Badge variant="outline" render={<button type="button" />} className={badgeClassName} />
          }
        >
          {children}
        </HoverCardTrigger>
      )}
      <HoverCardContent className="w-72 space-y-2 p-3" side="top">
        {labelsLine !== null ? (
          <p className="font-mono text-[11px] text-muted-foreground">{labelsLine}</p>
        ) : null}
        <p className="font-mono text-[11px] break-all text-foreground">{memoryKey}</p>
        {loading ? (
          <p className="text-xs text-muted-foreground">Loading preview…</p>
        ) : error !== null ? (
          <p className="text-xs text-destructive">{error}</p>
        ) : excerpt !== null ? (
          <p className="whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
            {excerpt}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">No text content.</p>
        )}
      </HoverCardContent>
    </HoverCard>
  );
}

export function MemoryEdgeHoverCard({
  client,
  namespace,
  edgeId,
  href,
  navigate,
  labelKinds,
  className,
  children,
}: {
  client: ReactMemoriesClient;
  namespace: string;
  edgeId: string;
  href: string;
  /** When set, plain left-clicks call this instead of full navigation. */
  navigate?: (href: string) => void;
  labelKinds?: readonly string[];
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<EdgePreviewJson | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || detail !== null || namespace.length === 0) return;
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    void client
      .getEdgePreview({ namespace, edgeId, signal: ac.signal })
      .then((preview) => {
        if (ac.signal.aborted) return;
        setDetail(preview);
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, [open, detail, client, namespace, edgeId]);

  const labelsFromDetail = detail?.labels?.map((lb) => lb.kind);
  const labelsLine = formatOntologyLabelChain(labelsFromDetail ?? labelKinds ?? [], "edge");
  const propCount = detail?.properties != null ? Object.keys(detail.properties).length : 0;

  return (
    <HoverCard open={open} onOpenChange={setOpen}>
      <HoverCardTrigger
        render={
          <Badge
            variant="secondary"
            render={<a href={href} />}
            className={cn("max-w-full truncate tracking-wide uppercase", className)}
          />
        }
        onClick={
          navigate !== undefined ? (e) => navigateIfPlainClick(e, href, navigate) : undefined
        }
      >
        {children}
      </HoverCardTrigger>
      <HoverCardContent className="w-72 space-y-2 p-3" side="top">
        {labelsLine.length > 0 ? (
          <p className="font-mono text-[11px] tracking-wide text-muted-foreground uppercase">
            {labelsLine}
          </p>
        ) : null}
        <p className="font-mono text-[11px] break-all text-foreground">{edgeId}</p>
        {loading ? (
          <p className="text-xs text-muted-foreground">Loading preview…</p>
        ) : error !== null ? (
          <p className="text-xs text-destructive">{error}</p>
        ) : detail !== null ? (
          <div className="space-y-1 text-xs text-muted-foreground">
            <p className="font-mono break-all">
              <span className="text-foreground/80">{detail.fromKey?.trim() || "—"}</span>
              <span className="mx-1">→</span>
              <span className="text-foreground/80">{detail.toKey?.trim() || "—"}</span>
            </p>
            {propCount > 0 ? (
              <p>
                {propCount} propert{propCount === 1 ? "y" : "ies"}
              </p>
            ) : (
              <p>No freeform properties.</p>
            )}
          </div>
        ) : null}
      </HoverCardContent>
    </HoverCard>
  );
}
