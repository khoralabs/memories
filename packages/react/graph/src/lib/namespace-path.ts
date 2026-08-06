/** Memories namespace path segment: lowercase alphanumerics, `_`, `-`. */
export const NAMESPACE_SEGMENT_REGEX = /^[a-z0-9_-]+$/;

export const NAMESPACE_MAX_DEPTH = 6;

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

/** Validate full path depth after joining parent + segment. */
export function validateNamespacePath(path: string): string | null {
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) return "Name is required";
  if (parts.length > NAMESPACE_MAX_DEPTH) {
    return `Namespace path must have at most ${NAMESPACE_MAX_DEPTH} segments`;
  }
  for (const part of parts) {
    if (!NAMESPACE_SEGMENT_REGEX.test(part)) {
      return "Use lowercase letters, digits, underscores, and hyphens only";
    }
  }
  return null;
}
