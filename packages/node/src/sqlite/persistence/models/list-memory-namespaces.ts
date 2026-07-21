import type { Database } from "bun:sqlite";

/**
 * All distinct `memories.namespace` values, sorted for stable UI.
 */
export function listMemoryNamespaces(db: Database): string[] {
  const rows = db
    .query<{ namespace: string }, []>(`SELECT DISTINCT namespace FROM memories ORDER BY namespace`)
    .all();
  return rows.map((r) => r.namespace);
}
