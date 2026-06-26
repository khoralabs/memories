import type { Database } from "bun:sqlite";
import type { GraphMemoryEmbedding } from "@khoralabs/memories-core";
import type { GraphProjectionSource } from "@khoralabs/memories-projections";
import { blobToVector, listNamespacesUnderPrefix } from "@khoralabs/memories-sqlite";

export function loadMeanEmbeddingsForNamespace(
  db: Database,
  namespace: string,
): GraphMemoryEmbedding[] {
  const rows = db
    .query<{ memory_id: string; key: string; vector: Buffer | Uint8Array }, [string]>(
      `SELECT vf.memory_id AS memory_id, m.key AS key, vf.vector AS vector
       FROM vector_features vf
       JOIN source_maps sm ON sm._id = vf.source_map_id
       JOIN memories m ON m._id = vf.memory_id
       WHERE m.namespace = ?
         AND sm.source_key NOT GLOB '__*'`,
    )
    .all(namespace);

  const byMemory = new Map<string, { key: string; sums: number[]; count: number; dim: number }>();

  for (const r of rows) {
    const floats = blobToVector(r.vector instanceof Buffer ? new Uint8Array(r.vector) : r.vector);
    const arr = Array.from(floats);
    const dim = arr.length;
    let agg = byMemory.get(r.memory_id);
    if (!agg) {
      agg = { key: r.key, sums: new Array(dim).fill(0), count: 0, dim };
      byMemory.set(r.memory_id, agg);
    }
    if (agg.dim !== dim) continue;
    for (let i = 0; i < dim; i++) {
      const v = arr[i];
      if (v === undefined) continue;
      agg.sums[i] = (agg.sums[i] ?? 0) + v;
    }
    agg.count += 1;
  }

  const out: GraphMemoryEmbedding[] = [];
  for (const [memoryId, agg] of byMemory) {
    if (agg.count === 0) continue;
    const embedding = agg.sums.map((s) => s / agg.count);
    out.push({
      memoryKey: agg.key,
      memoryId,
      embedding,
    });
  }
  return out;
}

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

export function createSqliteGraphProjectionSource(db: Database): GraphProjectionSource {
  return {
    async listNamespacesUnderPrefix(prefix) {
      return listNamespacesUnderPrefix(db, prefix);
    },
    async loadMeanEmbeddingsForNamespace(namespace) {
      return loadMeanEmbeddingsForNamespace(db, namespace);
    },
    async loadMemoryTextPreview(namespace, key, maxChars) {
      return loadMemoryTextPreview(db, namespace, key, maxChars);
    },
    async loadSourceMapTextPreview(sourceMapId, maxChars) {
      return loadSourceMapTextPreview(db, sourceMapId, maxChars);
    },
  };
}
