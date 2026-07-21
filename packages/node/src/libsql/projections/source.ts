import type { GraphMemoryEmbedding } from "@khoralabs/memories-persistence-core";
import type { GraphProjectionSource } from "../../projections/index";

export type LibsqlProjectionRow = Record<string, unknown>;

export type LibsqlProjectionQueryResult = {
  rows: readonly LibsqlProjectionRow[];
};

export type LibsqlProjectionStatement = {
  sql: string;
  args?: unknown;
};

export type LibsqlProjectionQueryClient = {
  execute(
    statement: string | LibsqlProjectionStatement,
    args?: unknown,
  ): Promise<LibsqlProjectionQueryResult>;
};

function executeQuery(
  queryClient: LibsqlProjectionQueryClient,
  sql: string,
  args: readonly unknown[],
): Promise<LibsqlProjectionQueryResult> {
  return queryClient.execute({ sql, args });
}

function stringValue(row: LibsqlProjectionRow, key: string): string | null {
  const value = row[key];
  return typeof value === "string" ? value : null;
}

function parseVectorJson(value: unknown): number[] | null {
  if (Array.isArray(value)) {
    const out = value.map((item) => (typeof item === "number" ? item : Number(item)));
    return out.every((item) => Number.isFinite(item)) ? out : null;
  }
  if (typeof value !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const out = parsed.map((item) => (typeof item === "number" ? item : Number(item)));
  return out.every((item) => Number.isFinite(item)) ? out : null;
}

export async function listNamespacesUnderPrefix(
  queryClient: LibsqlProjectionQueryClient,
  prefix: string,
): Promise<string[]> {
  const result = await executeQuery(
    queryClient,
    `SELECT DISTINCT namespace FROM memories
     WHERE namespace = ? OR namespace LIKE ? || '/%'
     ORDER BY namespace`,
    [prefix, prefix],
  );
  return result.rows.flatMap((row) => {
    const namespace = stringValue(row, "namespace");
    return namespace ? [namespace] : [];
  });
}

export async function loadMeanEmbeddingsForNamespace(
  queryClient: LibsqlProjectionQueryClient,
  namespace: string,
): Promise<GraphMemoryEmbedding[]> {
  const result = await executeQuery(
    queryClient,
    `SELECT vf.memory_id AS memory_id, m.key AS key, vector_extract(vf.vector) AS vector_json
     FROM vector_features vf
     JOIN source_maps sm ON sm._id = vf.source_map_id
     JOIN memories m ON m._id = vf.memory_id
     WHERE m.namespace = ?
       AND sm.source_key NOT GLOB '__*'`,
    [namespace],
  );

  const byMemory = new Map<string, { key: string; sums: number[]; count: number; dim: number }>();

  for (const row of result.rows) {
    const memoryId = stringValue(row, "memory_id");
    const key = stringValue(row, "key");
    if (!memoryId || !key) continue;
    const vector = parseVectorJson(row.vector_json);
    if (!vector) continue;
    const dim = vector.length;
    let agg = byMemory.get(memoryId);
    if (!agg) {
      agg = { key, sums: new Array(dim).fill(0), count: 0, dim };
      byMemory.set(memoryId, agg);
    }
    if (agg.dim !== dim) continue;
    for (let i = 0; i < dim; i++) {
      agg.sums[i] = (agg.sums[i] ?? 0) + (vector[i] ?? 0);
    }
    agg.count += 1;
  }

  const out: GraphMemoryEmbedding[] = [];
  for (const [memoryId, agg] of byMemory) {
    if (agg.count === 0) continue;
    out.push({
      memoryKey: agg.key,
      memoryId,
      embedding: agg.sums.map((sum) => sum / agg.count),
    });
  }
  return out;
}

export async function loadSourceMapTextPreview(
  queryClient: LibsqlProjectionQueryClient,
  sourceMapId: string,
  maxChars = 8000,
): Promise<string | null> {
  const result = await executeQuery(
    queryClient,
    `SELECT tf.text AS text
     FROM text_features tf
     WHERE tf.source_map_id = ?
     ORDER BY tf._ts_created ASC, tf._id ASC`,
    [sourceMapId],
  );
  const rows = result.rows.flatMap((row) => {
    const text = stringValue(row, "text");
    return text ? [text] : [];
  });
  if (rows.length === 0) return null;
  const joined = rows.join("\n\n");
  if (joined.length <= maxChars) return joined;
  return `${joined.slice(0, maxChars - 1)}…`;
}

export async function loadMemoryTextPreview(
  queryClient: LibsqlProjectionQueryClient,
  namespace: string,
  key: string,
  maxChars = 8000,
): Promise<string | null> {
  const result = await executeQuery(
    queryClient,
    `SELECT tf.text AS text
     FROM text_features tf
     JOIN memories m ON m._id = tf.memory_id
     WHERE m.namespace = ? AND m.key = ?
     ORDER BY tf._ts_created ASC, tf._id ASC`,
    [namespace, key],
  );
  const rows = result.rows.flatMap((row) => {
    const text = stringValue(row, "text");
    return text ? [text] : [];
  });
  if (rows.length === 0) return null;
  const joined = rows.join("\n\n");
  if (joined.length <= maxChars) return joined;
  return `${joined.slice(0, maxChars - 1)}…`;
}

export function createLibsqlGraphProjectionSource(
  queryClient: LibsqlProjectionQueryClient,
): GraphProjectionSource {
  return {
    listNamespacesUnderPrefix(prefix) {
      return listNamespacesUnderPrefix(queryClient, prefix);
    },
    loadMeanEmbeddingsForNamespace(namespace) {
      return loadMeanEmbeddingsForNamespace(queryClient, namespace);
    },
    loadMemoryTextPreview(namespace, key, maxChars) {
      return loadMemoryTextPreview(queryClient, namespace, key, maxChars);
    },
    loadSourceMapTextPreview(sourceMapId, maxChars) {
      return loadSourceMapTextPreview(queryClient, sourceMapId, maxChars);
    },
  };
}
