import type { Database } from "bun:sqlite";
import type { IncludeSuppressedOpts } from "../../../../persistence/core";
import { isNamespaceSuppressed } from "./namespace-metadata";

/**
 * All distinct `memories.namespace` values, sorted for stable UI.
 * Hides suppressed namespaces (self or under a suppressed ancestor) unless opted in.
 */
export function listMemoryNamespaces(db: Database, opts?: IncludeSuppressedOpts): string[] {
  const include = opts?.includeSuppressed === true;
  const rows = db
    .query<{ namespace: string }, []>(`SELECT DISTINCT namespace FROM memories ORDER BY namespace`)
    .all();
  if (include) return rows.map((r) => r.namespace);
  return rows.map((r) => r.namespace).filter((ns) => !isNamespaceSuppressed(db, ns));
}
