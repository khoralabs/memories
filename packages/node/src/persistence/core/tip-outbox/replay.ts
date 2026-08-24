import { decodeTipGraphSnapshot, type TipGraphSnapshotV1 } from "./graph-snapshot";
import { float32FromBytes } from "./payload";
import { buildTipOutboxLwwQuery, UNIFIED_TIP_TABLES } from "./replay-sql";
import { resolveTipPayloadRows } from "./resolve-payload";
import type { TipOutboxLwwRow, TipOutboxSqlDeps } from "./types";

export async function replayGraphSnapshotAtRootHex(
  deps: TipOutboxSqlDeps,
  rootHex: string,
  namespace: string,
  memoryKey: string,
): Promise<TipGraphSnapshotV1 | null> {
  const { sql, params } = buildTipOutboxLwwQuery(
    rootHex,
    { facet: "graph", namespace, memoryKey },
    UNIFIED_TIP_TABLES,
  );
  const rows = (await deps.queryAll<TipOutboxLwwRow>(sql, params)) as TipOutboxLwwRow[];
  const resolved = await resolveTipPayloadRows(deps, rows);
  const first = resolved[0];
  if (!first) return null;
  return decodeTipGraphSnapshot(first.bytes);
}

export async function replayVectorArmsAtRootHex(
  deps: TipOutboxSqlDeps,
  rootHex: string,
  namespace: string,
  memoryKey: string,
): Promise<Array<{ sourceKey: string; vector: number[] }>> {
  const { sql, params } = buildTipOutboxLwwQuery(
    rootHex,
    { facet: "vector", namespace, memoryKey },
    UNIFIED_TIP_TABLES,
  );
  const rows = (await deps.queryAll<TipOutboxLwwRow & { sourceKey: string }>(sql, params)) as Array<
    TipOutboxLwwRow & { sourceKey: string }
  >;
  const resolved = await resolveTipPayloadRows(deps, rows);
  const out: Array<{ sourceKey: string; vector: number[] }> = [];
  for (const row of rows) {
    if (!row?.sourceKey || !row.payloadSha256) continue;
    const payload = resolved.find((r) => r.payloadSha256 === row.payloadSha256);
    if (!payload) continue;
    out.push({ sourceKey: row.sourceKey, vector: float32FromBytes(payload.bytes) });
  }
  return out;
}

export async function replayProvenanceEventJsonAtRootHex(
  deps: TipOutboxSqlDeps,
  rootHex: string,
): Promise<string | null> {
  const { sql, params } = buildTipOutboxLwwQuery(
    rootHex,
    { facet: "provenance" },
    UNIFIED_TIP_TABLES,
  );
  const rows = (await deps.queryAll<TipOutboxLwwRow>(sql, params)) as TipOutboxLwwRow[];
  const resolved = await resolveTipPayloadRows(deps, rows);
  const first = resolved[0];
  if (!first) return null;
  return new TextDecoder().decode(first.bytes);
}
