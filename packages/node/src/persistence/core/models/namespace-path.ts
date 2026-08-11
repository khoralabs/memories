import z from "zod";

import { NamespaceConstraintError } from "./namespace-constraints";

/** Canonical segment separator for hierarchical memory namespaces. */
export const NAMESPACE_SEPARATOR = "/" as const;

/** Default write-policy max path depth (segments). Hosts may raise up to {@link NAMESPACE_ABSOLUTE_MAX_DEPTH}. */
export const NAMESPACE_MAX_DEPTH = 6;

/** Default write-policy max path length (characters). Hosts may raise up to {@link NAMESPACE_ABSOLUTE_MAX_PATH_LENGTH}. */
export const NAMESPACE_MAX_PATH_LENGTH = 512;

/** Absolute depth ceiling for storage / syntax validation and host policy clamps. */
export const NAMESPACE_ABSOLUTE_MAX_DEPTH = 32;

/** Absolute path-length ceiling for storage / syntax validation and host policy clamps. */
export const NAMESPACE_ABSOLUTE_MAX_PATH_LENGTH = 2048;

/** Allowed characters per segment (`[a-z0-9_-]+`). */
export const NAMESPACE_SEGMENT_REGEX = /^[a-z0-9_-]+$/;

/**
 * Full path pattern for Zod/Smithy row schemas: 1..{@link NAMESPACE_ABSOLUTE_MAX_DEPTH} segments.
 * Write policy depth/length is enforced separately via {@link assertNamespacePath}.
 */
export const MEMORY_NAMESPACE_PATH_REGEX = new RegExp(
  `^[a-z0-9_-]+(\\/[a-z0-9_-]+){0,${NAMESPACE_ABSOLUTE_MAX_DEPTH - 1}}$`,
);

/**
 * Validated hierarchical namespace (`/` segments, `[a-z0-9_-]+`).
 * Use {@link assertNamespacePath} at write boundaries; {@link parseNamespaceSyntax} for reads.
 */
export type NamespacePath = string;

/** Host/write policy for path depth and length (clamped to absolute ceilings). */
export type NamespacePathPolicy = {
  maxDepth?: number;
  maxLength?: number;
};

export const DEFAULT_NAMESPACE_PATH_POLICY: Readonly<{
  maxDepth: number;
  maxLength: number;
}> = {
  maxDepth: NAMESPACE_MAX_DEPTH,
  maxLength: NAMESPACE_MAX_PATH_LENGTH,
};

/**
 * Compile-time checks for string literals: non-empty, no leading/trailing/double slashes.
 * Runtime validation is still required via {@link zNamespacePath} or {@link assertNamespacePath}.
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

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

/** Resolve effective depth/length limits from optional host policy. */
export function resolveNamespacePathPolicy(policy?: NamespacePathPolicy): {
  maxDepth: number;
  maxLength: number;
} {
  return {
    maxDepth: clampInt(
      policy?.maxDepth ?? DEFAULT_NAMESPACE_PATH_POLICY.maxDepth,
      1,
      NAMESPACE_ABSOLUTE_MAX_DEPTH,
    ),
    maxLength: clampInt(
      policy?.maxLength ?? DEFAULT_NAMESPACE_PATH_POLICY.maxLength,
      1,
      NAMESPACE_ABSOLUTE_MAX_PATH_LENGTH,
    ),
  };
}

function parseSegmentsWithLimits(s: string, maxDepth: number, maxLength: number): string[] {
  if (s.length === 0) {
    throw new NamespaceConstraintError("invalid_path", "namespace path must be non-empty");
  }
  if (s.length > maxLength) {
    throw new NamespaceConstraintError(
      "invalid_path",
      `namespace path must be at most ${maxLength} characters`,
    );
  }
  if (s.startsWith("/") || s.endsWith("/") || s.includes("//")) {
    throw new NamespaceConstraintError(
      "invalid_path",
      "invalid namespace path: no leading, trailing, or double slashes",
    );
  }
  const parts = s.split(NAMESPACE_SEPARATOR);
  if (parts.length === 0 || parts.length > maxDepth) {
    throw new NamespaceConstraintError(
      "max_depth",
      `namespace path must have 1..${maxDepth} segments`,
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

/**
 * Syntax + absolute ceiling validation (for reads / hydration).
 * Does not apply host write policy depth/length defaults.
 */
export function parseNamespaceSyntax(s: string): string[] {
  return parseSegmentsWithLimits(
    s,
    NAMESPACE_ABSOLUTE_MAX_DEPTH,
    NAMESPACE_ABSOLUTE_MAX_PATH_LENGTH,
  );
}

/** Validate a path already stored in the DB (absolute ceilings only). */
export function namespacePathFromStored(s: string): NamespacePath {
  parseNamespaceSyntax(s);
  return s;
}

/**
 * Validate at write boundaries under host policy (defaults: depth 6, length 512).
 * Throws {@link NamespaceConstraintError} on violation.
 */
export function assertNamespacePath(s: string, policy?: NamespacePathPolicy): NamespacePath;
export function assertNamespacePath<S extends string>(
  s: NamespacePathLiteral<S>,
  policy?: NamespacePathPolicy,
): NamespacePath;
export function assertNamespacePath(s: string, policy?: NamespacePathPolicy): NamespacePath {
  const { maxDepth, maxLength } = resolveNamespacePathPolicy(policy);
  parseSegmentsWithLimits(s, maxDepth, maxLength);
  return s;
}

/**
 * Validate a namespace path. Prefer {@link assertNamespacePath} at writes and
 * {@link parseNamespaceSyntax} on reads. When `policy` is omitted, uses default write policy.
 */
export function namespacePath(s: string, policy?: NamespacePathPolicy): NamespacePath;
export function namespacePath<S extends string>(
  s: NamespacePathLiteral<S>,
  policy?: NamespacePathPolicy,
): NamespacePath;
export function namespacePath(s: string, policy?: NamespacePathPolicy): NamespacePath {
  return assertNamespacePath(s, policy);
}

/** Zod schema for {@link NamespacePath} under default write policy (depth 6, length 512). */
export const zNamespacePath = z
  .string()
  .min(1)
  .max(NAMESPACE_MAX_PATH_LENGTH)
  .superRefine((s, ctx) => {
    try {
      assertNamespacePath(s);
    } catch (e) {
      ctx.addIssue({
        code: "custom",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  })
  .transform((s): NamespacePath => s);

/** Zod schema under an explicit host policy. */
export function zNamespacePathWithPolicy(policy?: NamespacePathPolicy) {
  const { maxLength } = resolveNamespacePathPolicy(policy);
  return z
    .string()
    .min(1)
    .max(maxLength)
    .superRefine((s, ctx) => {
      try {
        assertNamespacePath(s, policy);
      } catch (e) {
        ctx.addIssue({
          code: "custom",
          message: e instanceof Error ? e.message : String(e),
        });
      }
    })
    .transform((s): NamespacePath => s);
}

export function namespaceSegments(p: NamespacePath): readonly string[] {
  return parseNamespaceSyntax(p);
}

export function namespaceFromSegments(
  segs: readonly string[],
  policy?: NamespacePathPolicy,
): NamespacePath {
  const { maxDepth } = resolveNamespacePathPolicy(policy);
  if (segs.length === 0 || segs.length > maxDepth) {
    throw new NamespaceConstraintError("max_depth", `namespace must have 1..${maxDepth} segments`);
  }
  for (const seg of segs) {
    if (seg.length === 0 || !NAMESPACE_SEGMENT_REGEX.test(seg)) {
      throw new NamespaceConstraintError(
        "invalid_path",
        `invalid namespace segment: ${JSON.stringify(seg)}`,
      );
    }
  }
  return assertNamespacePath(segs.join(NAMESPACE_SEPARATOR), policy);
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
