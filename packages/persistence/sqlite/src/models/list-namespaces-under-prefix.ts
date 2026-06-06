import type { Database } from "bun:sqlite";

/** Distinct namespaces equal to `prefix` or nested under it. */
export function listNamespacesUnderPrefix(db: Database, prefix: string): string[] {
  const rows = db
    .query<{ namespace: string }, [string, string]>(
      `SELECT DISTINCT namespace FROM memories
       WHERE namespace = ? OR namespace LIKE ? || '/%'
       ORDER BY namespace`,
    )
    .all(prefix, prefix);
  return rows.map((r) => r.namespace);
}
