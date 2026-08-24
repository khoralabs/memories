import { DEFAULT_CONTENT_OUTBOX_RETENTION_TIPS } from "../persistence/content-blob-cold-store";
import { utf8Bytes } from "../tip-outbox/payload";
import { SQL_UPSERT_TIP_BLOB_REHYDRATE } from "../tip-outbox/replay-sql";
import {
  type ContentAtRootHit,
  type ContentOutboxSqlDeps,
  type EvacuateContentBlobsOpts,
  type LwwArmRow,
  SQL_EVACUATE_TO_COLD,
  SQL_EVACUATE_TO_DROPPED,
  SQL_HOT_PROVENANCE_TIPS,
  sqlEvacuateCandidates,
} from "./content-outbox-sql";
import { sha256Hex } from "./sha256";

/** Full LWW reconstruct including cold-store fetch + optional hot rehydrate. */
export async function resolveLwwRows(
  deps: ContentOutboxSqlDeps,
  rows: readonly LwwArmRow[],
): Promise<ContentAtRootHit[]> {
  const coldStore = deps.coldStore;
  const out: ContentAtRootHit[] = [];
  for (const row of rows) {
    let text = row.blobText;
    if (text == null && row.location === "cold" && row.contentSha256 && coldStore) {
      const fetched = await coldStore.get(row.contentSha256);
      if (fetched !== null && sha256Hex(fetched) === row.contentSha256) {
        text = fetched;
        await deps.exec(SQL_UPSERT_TIP_BLOB_REHYDRATE, [utf8Bytes(fetched), row.contentSha256]);
      }
    }
    if (text == null) continue;
    if (row.location === "dropped" && row.blobText == null) continue;
    out.push({
      namespace: row.namespace,
      memoryKey: row.memoryKey,
      sourceKey: row.sourceKey,
      text,
    });
  }
  return out;
}

/**
 * Evict blob bodies for tips outside the hot window: upload to cold store if
 * configured; optionally drop when no cold store (`allowDropWithoutColdStore`).
 * Thin outbox rows are never deleted.
 */
export async function evacuateContentBlobsOutsideHotWindowWith(
  deps: ContentOutboxSqlDeps,
  opts?: EvacuateContentBlobsOpts,
): Promise<void> {
  try {
    await evacuateContentBlobsOutsideHotWindowInner(deps, opts);
  } catch (err) {
    if (deps.isClosedDatabaseError?.(err)) return;
    throw err;
  }
}

async function evacuateContentBlobsOutsideHotWindowInner(
  deps: ContentOutboxSqlDeps,
  opts?: EvacuateContentBlobsOpts,
): Promise<void> {
  const retention = opts?.retentionTips ?? DEFAULT_CONTENT_OUTBOX_RETENTION_TIPS;
  if (retention === 0) return;

  const coldStore = opts?.coldStore ?? deps.coldStore;
  const allowDrop = opts?.allowDropWithoutColdStore === true;
  if (coldStore === undefined && !allowDrop) return;

  const tipRows = await deps.queryAll<{ root_hex: string }>(SQL_HOT_PROVENANCE_TIPS, [retention]);
  const hotTips = tipRows.map((r) => r.root_hex);
  if (hotTips.length === 0) return;

  const candidates = await deps.queryAll<{
    content_sha256: string;
    payload: Uint8Array | null;
  }>(sqlEvacuateCandidates(hotTips.length), hotTips);

  for (const row of candidates) {
    if (row.payload == null) continue;
    const text = new TextDecoder().decode(row.payload);
    if (coldStore !== undefined) {
      if (sha256Hex(text) !== row.content_sha256) {
        console.error(
          `evacuateContentBlobs: sha mismatch for ${row.content_sha256}; skipping cold put`,
        );
        continue;
      }
      await coldStore.put(row.content_sha256, text);
      const uri = coldStore.uriFor(row.content_sha256);
      await deps.exec(SQL_EVACUATE_TO_COLD, [uri, row.content_sha256]);
    } else {
      await deps.exec(SQL_EVACUATE_TO_DROPPED, [row.content_sha256]);
    }
  }
}
