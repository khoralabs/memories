import type { Database } from "bun:sqlite";
import type { GraphMemoryEmbedding } from "@khoralabs/memories-core";
import { blobToVector } from "@khoralabs/memories-sqlite";

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
