/** Shared merge helpers for memory detail pages. */

export type PreviewContentArm = {
  sourceKey: string;
  text: string | null;
};

export type PreviewLabel = {
  kind: string;
  props: Record<string, unknown>;
};

/**
 * System search-meta / label-props chunks use `__` prefixes and must not be
 * re-submitted as user content on merge (`zUserSourceKey` in memories-node).
 */
export function isReservedContentSourceKey(sourceKey: string): boolean {
  return sourceKey.startsWith("__");
}

/** Content arms safe to show/edit in the UI (excludes system search-meta keys). */
export function userContentArms(arms: readonly PreviewContentArm[]): PreviewContentArm[] {
  return arms.filter((arm) => !isReservedContentSourceKey(arm.sourceKey));
}

export function contentArmsToMergeItems(
  arms: PreviewContentArm[],
  patch?: { sourceKey: string; text: string },
): Array<{ key: string; text?: string }> {
  return userContentArms(arms).map((arm) => {
    if (patch !== undefined && arm.sourceKey === patch.sourceKey) {
      return { key: arm.sourceKey, text: patch.text };
    }
    return {
      key: arm.sourceKey,
      ...(arm.text !== null ? { text: arm.text } : {}),
    };
  });
}

export function ensureMergeContent(
  arms: PreviewContentArm[],
  patch?: { sourceKey: string; text: string },
): Array<{ key: string; text?: string }> {
  const items = contentArmsToMergeItems(arms, patch);
  if (items.length > 0) return items;
  if (patch !== undefined && !isReservedContentSourceKey(patch.sourceKey)) {
    return [{ key: patch.sourceKey, text: patch.text }];
  }
  return [];
}
