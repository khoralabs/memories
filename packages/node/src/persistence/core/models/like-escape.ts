/**
 * Path-boundary match without `LIKE` wildcards: `col = prefix` or nested under `prefix/`.
 * Bind the same prefix value three times.
 */
export function sqlNamespaceEqualsOrUnderPrefix(col: string): string {
  return `(${col} = ? OR substr(${col}, 1, length(?) + 1) = ? || '/')`;
}

/**
 * Same as {@link sqlNamespaceEqualsOrUnderPrefix} when the prefix is another column
 * (e.g. suppressed `namespace_metadata._id`), not a bound parameter.
 */
export function sqlNamespaceEqualsOrUnderPrefixCol(col: string, prefixCol: string): string {
  return `(${col} = ${prefixCol} OR substr(${col}, 1, length(${prefixCol}) + 1) = ${prefixCol} || '/')`;
}

/** Prefix match without LIKE wildcards. Bind the same prefix value twice. */
export function sqlColumnStartsWithPrefix(col: string): string {
  return `substr(${col}, 1, length(?)) = ?`;
}
