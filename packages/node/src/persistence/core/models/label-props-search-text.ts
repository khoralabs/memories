/**
 * Human-readable lines for lexical indexing of ontology label props (avoid raw JSON).
 */
export type {
  LabelPropsSearchFormatter,
  LabelPropsSearchRole,
} from "@khoralabs/memories-ontologies";

import type {
  LabelPropsSearchFormatter,
  LabelPropsSearchRole,
} from "@khoralabs/memories-ontologies";

function isNonEmptyProps(props: unknown): props is Record<string, unknown> {
  return (
    typeof props === "object" &&
    props !== null &&
    !Array.isArray(props) &&
    Object.keys(props as object).length > 0
  );
}

function formatScalar(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map(formatScalar).filter(Boolean).join(", ");
  return "";
}

/** One line per top-level key; nested objects use `parent.child: value` for scalars. */
function flattenPropsLines(props: Record<string, unknown>, prefix = ""): string[] {
  const lines: string[] = [];
  const keys = Object.keys(props).sort((a, b) => a.localeCompare(b));
  for (const key of keys) {
    const label = prefix ? `${prefix}.${key}` : key;
    const val = props[key];
    if (val === null || val === undefined) continue;
    if (typeof val === "object" && !Array.isArray(val) && val !== null) {
      lines.push(...flattenPropsLines(val as Record<string, unknown>, label));
      continue;
    }
    const s = formatScalar(val);
    if (s.length > 0) {
      const pretty = label.replace(/_/g, " ");
      lines.push(`${pretty}: ${s}`);
    }
  }
  return lines;
}

/**
 * Generic ontology-agnostic search text for label props (sorted keys, `Key: value` lines).
 * @param kind - Node or edge label kind (included as header line).
 */
export function propsToHumanSearchText(kind: string, props: unknown): string {
  if (!isNonEmptyProps(props)) return "";
  const lines = flattenPropsLines(props);
  if (lines.length === 0) return "";
  return [`Kind: ${kind}`, ...lines].join("\n");
}

/**
 * Apply optional per-kind formatter, then {@link propsToHumanSearchText} if formatter returns empty.
 */
export function formatLabelPropsForSearch(
  kind: string,
  role: LabelPropsSearchRole,
  props: unknown,
  formatter?: LabelPropsSearchFormatter,
): string {
  if (!isNonEmptyProps(props)) return "";
  const fromFn = formatter?.(kind, role, props)?.trim() ?? "";
  if (fromFn.length > 0) return fromFn;
  return propsToHumanSearchText(kind, props);
}

export { isNonEmptyProps };
