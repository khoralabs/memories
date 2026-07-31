import z from "zod";

import { NamespaceConstraintError } from "./namespace-constraints";

/** Canonical segment separator for hierarchical memory namespaces. */
export const NAMESPACE_SEPARATOR = "/" as const;

/** Max path depth (segments) for namespace path grammar. */
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
    throw new NamespaceConstraintError("invalid_path", "namespace path must be non-empty");
  }
  if (s.startsWith("/") || s.endsWith("/") || s.includes("//")) {
    throw new NamespaceConstraintError(
      "invalid_path",
      "invalid namespace path: no leading, trailing, or double slashes",
    );
  }
  const parts = s.split(NAMESPACE_SEPARATOR);
  if (parts.length === 0 || parts.length > NAMESPACE_MAX_DEPTH) {
    throw new NamespaceConstraintError(
      "max_depth",
      `namespace path must have 1..${NAMESPACE_MAX_DEPTH} segments`,
    );
  }
  for (const p of parts) {
    if (p.length === 0 || !NAMESPACE_SEGMENT_REGEX.test(p)) {
      throw new NamespaceConstraintError(
        "invalid_path",
        `invalid namespace segment (use [a-z0-9_-]+ only): ${JSON.stringify(p)}`,
      );
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

/**
 * Validate at runtime and return a branded path.
 * Throws {@link NamespaceConstraintError} on violation.
 */
export function namespacePath(s: string): NamespacePath;
export function namespacePath<S extends string>(s: NamespacePathLiteral<S>): NamespacePath;
export function namespacePath(s: string): NamespacePath {
  parseSegments(s);
  return s;
}

/** Alias of {@link namespacePath} for call sites that want constraint-oriented naming. */
export const assertNamespacePath = namespacePath;

export function namespaceSegments(p: NamespacePath): readonly string[] {
  return parseSegments(p);
}

export function namespaceFromSegments(segs: readonly string[]): NamespacePath {
  if (segs.length === 0 || segs.length > NAMESPACE_MAX_DEPTH) {
    throw new NamespaceConstraintError(
      "max_depth",
      `namespace must have 1..${NAMESPACE_MAX_DEPTH} segments`,
    );
  }
  for (const seg of segs) {
    if (seg.length === 0 || !NAMESPACE_SEGMENT_REGEX.test(seg)) {
      throw new NamespaceConstraintError(
        "invalid_path",
        `invalid namespace segment: ${JSON.stringify(seg)}`,
      );
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
