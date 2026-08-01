/**
 * Bounds on `memories._ts_created` for hybrid search.
 * Each present field becomes an AND clause (`>`, `>=`, `<`, `<=`).
 */
export type SearchAsOf = {
  gt?: number;
  gte?: number;
  lt?: number;
  lte?: number;
};

const OPS = ["gt", "gte", "lt", "lte"] as const;

function assertFinite(label: string, value: number): void {
  if (!Number.isFinite(value)) {
    throw new Error(`SearchAsOf.${label} must be a finite number`);
  }
}

/**
 * Merge deprecated `asOfTimestampMs` (lte alias) with `asOf`.
 * Returns `undefined` when neither is set.
 */
export function normalizeSearchAsOf(input: {
  asOf?: SearchAsOf;
  asOfTimestampMs?: number;
}): SearchAsOf | undefined {
  const { asOf, asOfTimestampMs } = input;
  if (asOf === undefined && asOfTimestampMs === undefined) return undefined;

  if (asOfTimestampMs !== undefined) assertFinite("asOfTimestampMs", asOfTimestampMs);

  if (asOf === undefined) {
    return { lte: asOfTimestampMs };
  }

  if (asOf === null || typeof asOf !== "object" || Array.isArray(asOf)) {
    throw new Error("SearchParams.asOf must be an object");
  }

  const out: SearchAsOf = {};
  for (const op of OPS) {
    const v = asOf[op];
    if (v === undefined) continue;
    assertFinite(op, v);
    out[op] = v;
  }

  if (asOfTimestampMs !== undefined) {
    if (out.lte !== undefined && out.lte !== asOfTimestampMs) {
      throw new Error(
        "SearchParams.asOf.lte and asOfTimestampMs conflict (must be equal when both set)",
      );
    }
    out.lte = asOfTimestampMs;
  }

  if (OPS.every((op) => out[op] === undefined)) {
    throw new Error("SearchParams.asOf must include at least one of gt, gte, lt, lte");
  }

  const lower = out.gte !== undefined ? out.gte : out.gt !== undefined ? out.gt : undefined;
  const upper = out.lte !== undefined ? out.lte : out.lt !== undefined ? out.lt : undefined;
  if (lower !== undefined && upper !== undefined && lower > upper) {
    throw new Error("SearchParams.asOf lower bound exceeds upper bound");
  }

  return out;
}

/** SQL fragment + bindings for `_ts_created` bounds (stable op order: gt, gte, lt, lte). */
export function asOfSqlClause(
  asOf: SearchAsOf | undefined,
  columnSql: string,
): { sql: string; bindings: number[] } {
  if (asOf === undefined) return { sql: "", bindings: [] };
  const parts: string[] = [];
  const bindings: number[] = [];
  if (asOf.gt !== undefined) {
    parts.push(` AND ${columnSql} > ?`);
    bindings.push(asOf.gt);
  }
  if (asOf.gte !== undefined) {
    parts.push(` AND ${columnSql} >= ?`);
    bindings.push(asOf.gte);
  }
  if (asOf.lt !== undefined) {
    parts.push(` AND ${columnSql} < ?`);
    bindings.push(asOf.lt);
  }
  if (asOf.lte !== undefined) {
    parts.push(` AND ${columnSql} <= ?`);
    bindings.push(asOf.lte);
  }
  return { sql: parts.join(""), bindings };
}
