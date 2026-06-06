import z from "zod";

/** Canonical segment separator for hierarchical memory namespaces. */
export const NAMESPACE_SEPARATOR = "/" as const;

/** Max path depth (segments); matches SQLite `ns_prefix_1`..`ns_prefix_6` and Convex `nsPrefix1`..`nsPrefix6`. */
export const NAMESPACE_MAX_DEPTH = 6;

/** Allowed characters per segment (`[a-z0-9_-]+`). */
export const NAMESPACE_SEGMENT_REGEX = /^[a-z0-9_-]+$/;

/** Full path pattern for Zod/Smithy (1..6 segments); use in row schemas without Zod `pipe` types. */
export const MEMORY_NAMESPACE_PATH_REGEX = /^[a-z0-9_-]+(\/[a-z0-9_-]+){0,5}$/;

/**
 * Validated hierarchical namespace (`/` segments, `[a-z0-9_-]+`, depth 1..6).
 * Use {@link namespacePath} or {@link zNamespacePath} to assert at boundaries; plain `string` is accepted for ergonomics.
 */
export type NamespacePath = string;

/**
 * Compile-time checks for string literals: non-empty, no leading/trailing/double slashes.
 * Runtime validation is still required via {@link zNamespacePath} or {@link namespacePath}.
 */
export type NamespacePathLiteral<S extends string> = S extends ""
  ? never
  : S extends `/${string}`
    ? never
    : S extends `${string}/`
      ? never
      : S extends `${string}//${string}`
        ? never
        : S;

function parseSegments(s: string): string[] {
  if (s.length === 0) {
    throw new Error("namespace path must be non-empty");
  }
  if (s.startsWith("/") || s.endsWith("/") || s.includes("//")) {
    throw new Error("invalid namespace path: no leading, trailing, or double slashes");
  }
  const parts = s.split(NAMESPACE_SEPARATOR);
  if (parts.length === 0 || parts.length > NAMESPACE_MAX_DEPTH) {
    throw new Error(`namespace path must have 1..${NAMESPACE_MAX_DEPTH} segments`);
  }
  for (const p of parts) {
    if (p.length === 0 || !NAMESPACE_SEGMENT_REGEX.test(p)) {
      throw new Error(`invalid namespace segment (use [a-z0-9_-]+ only): ${JSON.stringify(p)}`);
    }
  }
  return parts;
}

/** Zod schema for {@link NamespacePath} (strict segments, depth 1..6). */
export const zNamespacePath = z
  .string()
  .min(1)
  .max(128)
  .superRefine((s, ctx) => {
    try {
      parseSegments(s);
    } catch (e) {
      ctx.addIssue({
        code: "custom",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  })
  .transform((s): NamespacePath => s);

/** Validate at runtime and return a branded path. */
export function namespacePath(s: string): NamespacePath;
export function namespacePath<S extends string>(s: NamespacePathLiteral<S>): NamespacePath;
export function namespacePath(s: string): NamespacePath {
  parseSegments(s);
  return s;
}

export function namespaceSegments(p: NamespacePath): readonly string[] {
  return parseSegments(p);
}

export function namespaceFromSegments(segs: readonly string[]): NamespacePath {
  if (segs.length === 0 || segs.length > NAMESPACE_MAX_DEPTH) {
    throw new Error(`namespace must have 1..${NAMESPACE_MAX_DEPTH} segments`);
  }
  for (const seg of segs) {
    if (seg.length === 0 || !NAMESPACE_SEGMENT_REGEX.test(seg)) {
      throw new Error(`invalid namespace segment: ${JSON.stringify(seg)}`);
    }
  }
  return namespacePath(segs.join(NAMESPACE_SEPARATOR));
}

/** True if `ancestor` is a prefix path of `descendant` (including equality). */
export function isPrefixOf(ancestor: NamespacePath, descendant: NamespacePath): boolean {
  const a = namespaceSegments(ancestor);
  const d = namespaceSegments(descendant);
  if (a.length > d.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== d[i]) return false;
  }
  return true;
}

/**
 * Drop paths that are strict descendants of another path in the set (subtree roots only).
 * Order is not preserved; result is sorted by ascending depth.
 */
export function canonicalizeNamespacePrefixes(
  paths: readonly NamespacePath[],
): readonly NamespacePath[] {
  const unique = [...new Set(paths)];
  unique.sort((a, b) => namespaceSegments(a).length - namespaceSegments(b).length);
  const out: NamespacePath[] = [];
  for (const p of unique) {
    const covered = out.some(
      (r) =>
        r !== p && isPrefixOf(r, p) && namespaceSegments(r).length < namespaceSegments(p).length,
    );
    if (covered) continue;
    out.push(p);
  }
  return out;
}

/**
 * First `cap` segment values; unused trailing slots are `null` (length always `cap`).
 */
export function namespaceLevels(
  p: NamespacePath,
  cap: number = NAMESPACE_MAX_DEPTH,
): readonly (string | null)[] {
  const segs = namespaceSegments(p);
  const out: (string | null)[] = [];
  for (let i = 0; i < cap; i++) {
    const seg = segs[i];
    out.push(i < segs.length && seg !== undefined ? seg : null);
  }
  return out;
}

/** Cumulative path prefixes for SQLite subtree filters (`ns_prefix_k` = first k segments joined). */
export const NS_PREFIX_KEYS = [
  "ns_prefix_1",
  "ns_prefix_2",
  "ns_prefix_3",
  "ns_prefix_4",
  "ns_prefix_5",
  "ns_prefix_6",
] as const;

export type NamespacePrefixKey = (typeof NS_PREFIX_KEYS)[number];

/** Cumulative path prefixes for Convex subtree filters (`nsPrefix_k` = first k segments joined). */
export const NS_PREFIX_KEYS_CAMEL = [
  "nsPrefix1",
  "nsPrefix2",
  "nsPrefix3",
  "nsPrefix4",
  "nsPrefix5",
  "nsPrefix6",
] as const;

export type NamespacePrefixKeyCamel = (typeof NS_PREFIX_KEYS_CAMEL)[number];

/** `depth` is segment count (1..6); maps to `ns_prefix_depth`. */
export function namespacePrefixFieldForDepth(depth: number): NamespacePrefixKey {
  if (depth < 1 || depth > NAMESPACE_MAX_DEPTH) {
    throw new Error(`namespace prefix depth must be 1..${NAMESPACE_MAX_DEPTH}`);
  }
  const key = NS_PREFIX_KEYS[depth - 1];
  if (key === undefined) throw new Error("namespacePrefixFieldForDepth: invalid depth");
  return key;
}

/** `depth` is segment count (1..6); maps to `nsPrefix{depth}` on Convex tables. */
export function namespacePrefixFieldForDepthCamel(depth: number): NamespacePrefixKeyCamel {
  if (depth < 1 || depth > NAMESPACE_MAX_DEPTH) {
    throw new Error(`namespace prefix depth must be 1..${NAMESPACE_MAX_DEPTH}`);
  }
  const key = NS_PREFIX_KEYS_CAMEL[depth - 1];
  if (key === undefined) throw new Error("namespacePrefixFieldForDepthCamel: invalid depth");
  return key;
}

/** Spread into SQLite `memories` rows (only defined prefixes are set). */
export function namespacePrefixFields(
  p: NamespacePath,
  cap: number = NAMESPACE_MAX_DEPTH,
): Partial<Record<NamespacePrefixKey, string>> {
  const segs = namespaceSegments(p);
  const n = Math.min(segs.length, cap);
  const out: Partial<Record<NamespacePrefixKey, string>> = {};
  for (let k = 1; k <= n; k++) {
    const key = NS_PREFIX_KEYS[k - 1];
    const prefix = segs.slice(0, k).join(NAMESPACE_SEPARATOR);
    if (key !== undefined) out[key] = prefix;
  }
  return out;
}

/** Spread into Convex `text_features` / vector tables (only defined prefixes are set). */
export function namespacePrefixFieldsCamel(
  p: NamespacePath,
  cap: number = NAMESPACE_MAX_DEPTH,
): Partial<Record<NamespacePrefixKeyCamel, string>> {
  const segs = namespaceSegments(p);
  const n = Math.min(segs.length, cap);
  const out: Partial<Record<NamespacePrefixKeyCamel, string>> = {};
  for (let k = 1; k <= n; k++) {
    const key = NS_PREFIX_KEYS_CAMEL[k - 1];
    const prefix = segs.slice(0, k).join(NAMESPACE_SEPARATOR);
    if (key !== undefined) out[key] = prefix;
  }
  return out;
}
