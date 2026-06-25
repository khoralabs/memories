/** Serialize optional JSON properties for SQLite `TEXT` columns; empty objects become `NULL`. */
export function jsonOrNull(v: Record<string, unknown> | undefined): string | null {
  if (v === undefined || Object.keys(v).length === 0) return null;
  return JSON.stringify(v);
}
