import type { Database } from "bun:sqlite";

/** Searchable / display text attached to one `source_map` row (not the whole memory). */
export function loadSourceMapTextPreview(
  db: Database,
  sourceMapId: string,
  maxChars = 8000,
): string | null {
  const rows = db
    .query<{ text: string }, [string]>(
      `SELECT tf.text AS text
       FROM text_features tf
       WHERE tf.source_map_id = ?
       ORDER BY tf._ts_created ASC, tf._id ASC`,
    )
    .all(sourceMapId);
  if (rows.length === 0) return null;
  const joined = rows.map((r) => r.text).join("\n\n");
  if (joined.length <= maxChars) return joined;
  return `${joined.slice(0, maxChars - 1)}…`;
}

export function loadMemoryTextPreview(
  db: Database,
  namespace: string,
  key: string,
  maxChars = 8000,
): string | null {
  const rows = db
    .query<{ text: string }, [string, string]>(
      `SELECT tf.text AS text
       FROM text_features tf
       JOIN memories m ON m._id = tf.memory_id
       WHERE m.namespace = ? AND m.key = ?
       ORDER BY tf._ts_created ASC, tf._id ASC`,
    )
    .all(namespace, key);
  if (rows.length === 0) return null;
  const joined = rows.map((r) => r.text).join("\n\n");
  if (joined.length <= maxChars) return joined;
  return `${joined.slice(0, maxChars - 1)}…`;
}
