/** Memories namespace path segment: lowercase alphanumerics, `_`, `-`. */
export const NAMESPACE_SEGMENT_REGEX = /^[a-z0-9_-]+$/;

/** Default write-policy max path depth (matches memories-node default). */
export const NAMESPACE_MAX_DEPTH = 6;

/** Default write-policy max path length (matches memories-node default). */
export const NAMESPACE_MAX_PATH_LENGTH = 512;

export type NamespacePathPolicy = {
  maxDepth?: number;
  maxLength?: number;
};

export function joinNamespacePath(parent: string | undefined, segment: string): string {
  const parentTrimmed = parent?.trim() ?? "";
  return parentTrimmed.length > 0 ? `${parentTrimmed}/${segment}` : segment;
}

/** Validate a single path segment; returns an error message or null. */
export function validateNamespaceSegment(raw: string): string | null {
  const segment = raw.trim();
  if (segment.length === 0) return "Name is required";
  if (!NAMESPACE_SEGMENT_REGEX.test(segment)) {
    return "Use lowercase letters, digits, underscores, and hyphens only";
  }
  return null;
}

/** Validate full path depth/length after joining parent + segment. */
export function validateNamespacePath(path: string, policy?: NamespacePathPolicy): string | null {
  const maxDepth = policy?.maxDepth ?? NAMESPACE_MAX_DEPTH;
  const maxLength = policy?.maxLength ?? NAMESPACE_MAX_PATH_LENGTH;
  if (path.length > maxLength) {
    return `Namespace path must be at most ${maxLength} characters`;
  }
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) return "Name is required";
  if (parts.length > maxDepth) {
    return `Namespace path must have at most ${maxDepth} segments`;
  }
  for (const part of parts) {
    if (!NAMESPACE_SEGMENT_REGEX.test(part)) {
      return "Use lowercase letters, digits, underscores, and hyphens only";
    }
  }
  return null;
}
