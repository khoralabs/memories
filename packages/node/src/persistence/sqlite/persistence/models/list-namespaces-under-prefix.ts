import type { Database } from "bun:sqlite";
import type { IncludeSuppressedOpts } from "../../../../persistence/core";
import { sqlNamespaceEqualsOrUnderPrefix } from "../../../../persistence/core";
import { isNamespaceSuppressed } from "./namespace-metadata";

/** Distinct namespaces equal to `prefix` or nested under it. */
export function listNamespacesUnderPrefix(
  db: Database,
  prefix: string,
  opts?: IncludeSuppressedOpts,
): string[] {
  const include = opts?.includeSuppressed === true;
  const rows = db
    .query<{ namespace: string }, [string, string, string]>(
      `SELECT DISTINCT namespace FROM memories
       WHERE ${sqlNamespaceEqualsOrUnderPrefix("namespace")}
       ORDER BY namespace`,
    )
    .all(prefix, prefix, prefix);
  const out: string[] = [];
  for (const r of rows) {
    if (!include && isNamespaceSuppressed(db, r.namespace)) continue;
    out.push(r.namespace);
  }
  // Include metadata-only suppressed paths when opting in (zero memories still listable for projection).
  if (include) {
    const metaRows = db
      .query<{ id: string }, [string, string, string]>(
        `SELECT _id AS id FROM namespace_metadata
         WHERE ${sqlNamespaceEqualsOrUnderPrefix("_id")}`,
      )
      .all(prefix, prefix, prefix);
    const seen = new Set(out);
    for (const r of metaRows) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      out.push(r.id);
    }
    out.sort();
  }
  return out;
}
