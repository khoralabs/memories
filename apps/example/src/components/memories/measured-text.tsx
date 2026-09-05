import { useMemo } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { measure, type WhiteSpaceMode } from "@/lib/pretext-measure";
import { cn } from "@/lib/utils";

export type MeasuredTextProps = {
  text: string;
  /** Canvas font shorthand; must match CSS for the rendered span. */
  font: string;
  /** Pixels; must match the rendered span's CSS line-height. */
  lineHeight: number;
  /** Px cap; pretext shrink-wraps tighter. */
  maxWidth: number;
  /** Truncate beyond this with `…`. */
  maxLines: number;
  whiteSpace?: WhiteSpaceMode;
  letterSpacing?: number;
  className?: string;
  /** Tooltip portal target; pairs with `marker.tsx`'s drei-Html portal. */
  tooltipContainer?: HTMLElement | null;
  /** Side of the expand-on-hover tooltip. */
  tooltipSide?: "top" | "right" | "bottom" | "left";
};

/**
 * Lays out `text` with pretext, renders deterministic width/height lines, and on truncation
 * wraps the block in a Radix tooltip that exposes the full text on hover/click.
 */
export function MeasuredText({
  text,
  font,
  lineHeight,
  maxWidth,
  maxLines,
  whiteSpace,
  letterSpacing,
  className,
  tooltipContainer,
  tooltipSide,
}: MeasuredTextProps) {
  const result = useMemo(
    () =>
      measure({
        text,
        font,
        lineHeight,
        maxWidth,
        maxLines,
        ...(whiteSpace !== undefined ? { whiteSpace } : {}),
        ...(letterSpacing !== undefined ? { letterSpacing } : {}),
      }),
    [text, font, lineHeight, maxWidth, maxLines, whiteSpace, letterSpacing],
  );

  if (result.lines.length === 0) return null;

  const block = (
    <span
      className={cn("block", className)}
      style={{
        width: `${result.width}px`,
        height: `${result.height}px`,
        lineHeight: `${lineHeight}px`,
      }}
      title={result.truncated ? text : undefined}
    >
      {result.lines.map((line, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: lines are paragraph-positional, not identity-bearing
          key={i}
          className="block"
          style={{ height: `${lineHeight}px` }}
        >
          {line.length === 0 ? "\u00a0" : line}
        </span>
      ))}
    </span>
  );

  if (!result.truncated) return block;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{block}</TooltipTrigger>
        <TooltipContent
          container={tooltipContainer ?? null}
          side={tooltipSide ?? "right"}
          className="max-w-[min(28rem,92vw)] whitespace-pre-wrap text-left text-xs"
        >
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
