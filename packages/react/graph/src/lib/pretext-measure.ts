import {
  clearCache,
  layoutWithLines,
  type PreparedTextWithSegments,
  prepareWithSegments,
  walkLineRanges,
} from "@chenglou/pretext";

export type WhiteSpaceMode = "normal" | "pre-wrap";

export type MeasureArgs = {
  text: string;
  /** Canvas font shorthand (e.g. `'500 12px ui-sans-serif, system-ui, sans-serif'`). Must match CSS. */
  font: string;
  /** Pixels; must match the rendered span's CSS line-height. */
  lineHeight: number;
  /** Cap; pretext shrink-wraps tighter via {@link walkLineRanges}. */
  maxWidth: number;
  /** Beyond this, we trim to N lines and append `…` to the last visible line. */
  maxLines: number;
  whiteSpace?: WhiteSpaceMode;
  letterSpacing?: number;
};

export type MeasureResult = {
  width: number;
  height: number;
  /** Up to {@link MeasureArgs.maxLines} entries; last entry has `…` when {@link truncated}. */
  lines: string[];
  truncated: boolean;
  /** Total line count from pretext (pre-truncation), useful for callers. */
  totalLineCount: number;
};

const cache = new Map<string, PreparedTextWithSegments>();

function cacheKey(
  font: string,
  whiteSpace: WhiteSpaceMode,
  letterSpacing: number,
  text: string,
): string {
  return `${font}\0${whiteSpace}\0${letterSpacing}\0${text}`;
}

function getPrepared(
  text: string,
  font: string,
  whiteSpace: WhiteSpaceMode,
  letterSpacing: number,
): PreparedTextWithSegments | null {
  if (typeof document === "undefined") return null;
  const key = cacheKey(font, whiteSpace, letterSpacing, text);
  const hit = cache.get(key);
  if (hit) return hit;
  const prepared = prepareWithSegments(text, font, { whiteSpace, letterSpacing });
  cache.set(key, prepared);
  return prepared;
}

const EMPTY: MeasureResult = {
  width: 0,
  height: 0,
  lines: [],
  truncated: false,
  totalLineCount: 0,
};

/**
 * Shrink-wrap to the widest forced line (capped at {@link MeasureArgs.maxWidth}), lay out at that
 * width, then trim to {@link MeasureArgs.maxLines} with a trailing `…` when content overflows.
 */
export function measure(args: MeasureArgs): MeasureResult {
  const {
    text,
    font,
    lineHeight,
    maxWidth,
    maxLines,
    whiteSpace = "pre-wrap",
    letterSpacing = 0,
  } = args;
  if (text.length === 0 || maxWidth <= 0 || maxLines <= 0) return EMPTY;

  const prepared = getPrepared(text, font, whiteSpace, letterSpacing);
  if (!prepared) {
    return {
      width: maxWidth,
      height: lineHeight * Math.max(1, Math.min(maxLines, 1)),
      lines: [text],
      truncated: false,
      totalLineCount: 1,
    };
  }

  let widest = 0;
  walkLineRanges(prepared, maxWidth, (l) => {
    if (l.width > widest) widest = l.width;
  });
  const width = widest > 0 ? Math.min(maxWidth, Math.ceil(widest)) : maxWidth;

  const { lines } = layoutWithLines(prepared, width, lineHeight);
  const totalLineCount = lines.length;
  const truncated = totalLineCount > maxLines;
  const visible = (truncated ? lines.slice(0, maxLines) : lines).map((l) => l.text);
  if (truncated && visible.length > 0) {
    const last = visible[visible.length - 1] ?? "";
    visible[visible.length - 1] = `${last.replace(/\s+$/u, "")}…`;
  }

  return {
    width,
    height: visible.length * lineHeight,
    lines: visible,
    truncated,
    totalLineCount,
  };
}

/** Drops cached `prepareWithSegments` handles. Call from tests/HMR if needed. */
export function clearMeasureCache(): void {
  cache.clear();
  clearCache();
}

export const FONT_TOOLTIP_KINDS = "500 12px ui-sans-serif, system-ui, sans-serif";
export const FONT_TOOLTIP_BODY = "400 10px ui-sans-serif, system-ui, sans-serif";
export const FONT_EDGE_LABEL = "500 10px ui-sans-serif, system-ui, sans-serif";
export const FONT_EDGE_BODY = "400 10px ui-sans-serif, system-ui, sans-serif";
