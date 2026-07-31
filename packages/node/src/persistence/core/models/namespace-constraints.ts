/** Codes for {@link NamespaceConstraintError}. */
export type NamespaceConstraintCode = "max_depth" | "max_namespaces" | "invalid_path";

/** Typed violation of namespace path grammar or count limits. */
export class NamespaceConstraintError extends Error {
  readonly code: NamespaceConstraintCode;

  constructor(code: NamespaceConstraintCode, message: string) {
    super(message);
    this.name = "NamespaceConstraintError";
    this.code = code;
  }
}

/**
 * When `maxNamespaces` is set, reject introducing `candidate` if it is not already
 * among `existingPaths` and the distinct count is already at the cap.
 */
export function assertNamespaceCountAllowsNew(
  existingPaths: ReadonlySet<string> | readonly string[],
  candidate: string,
  maxNamespaces: number | undefined,
): void {
  if (maxNamespaces === undefined) return;
  if (!Number.isFinite(maxNamespaces) || maxNamespaces < 0) {
    throw new NamespaceConstraintError(
      "max_namespaces",
      "maxNamespaces must be a non-negative finite number when set",
    );
  }
  const set = existingPaths instanceof Set ? existingPaths : new Set(existingPaths);
  if (set.has(candidate)) return;
  if (set.size >= maxNamespaces) {
    throw new NamespaceConstraintError(
      "max_namespaces",
      `namespace limit exceeded: at most ${maxNamespaces} distinct namespaces allowed`,
    );
  }
}
