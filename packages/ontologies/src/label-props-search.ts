/**
 * Label-props search formatting hooks used by ontology family formatters
 * and by persistence when building lexical index text.
 */

export type LabelPropsSearchRole = "node" | "edge";

/** Optional per-kind override; return empty string to fall back to generic formatting. */
export type LabelPropsSearchFormatter = (
  kind: string,
  role: LabelPropsSearchRole,
  props: Record<string, unknown>,
) => string;
