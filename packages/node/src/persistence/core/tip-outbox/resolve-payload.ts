import { sha256Hex } from "../models/sha256";
import { utf8Decode } from "./payload";
import { SQL_SELECT_TIP_BLOB, SQL_UPSERT_TIP_BLOB_REHYDRATE } from "./replay-sql";
import type { TipOutboxLwwRow, TipOutboxSqlDeps } from "./types";

export type ResolvedTipPayload = {
  payloadSha256: string;
  bytes: Uint8Array;
};

export async function resolveTipPayloadRows(
  deps: TipOutboxSqlDeps,
  rows: readonly TipOutboxLwwRow[],
  opts?: { selectBlobSql?: string; rehydrateSql?: string },
): Promise<ResolvedTipPayload[]> {
  const selectSql = opts?.selectBlobSql ?? SQL_SELECT_TIP_BLOB;
  const rehydrateSql = opts?.rehydrateSql ?? SQL_UPSERT_TIP_BLOB_REHYDRATE;
  const coldStore = deps.coldStore;
  const out: ResolvedTipPayload[] = [];

  for (const row of rows) {
    if (!row.payloadSha256) continue;
    let bytes: Uint8Array | null = null;

    if (row.blobBytes != null) {
      bytes = row.blobBytes;
    } else if (row.blobText != null) {
      bytes = new TextEncoder().encode(row.blobText);
    } else {
      const blobs = await deps.queryAll<{
        location: string;
        text: string | null;
        payload?: Uint8Array;
      }>(selectSql, [row.payloadSha256]);
      const blob = blobs[0];
      if (blob?.text != null) {
        bytes = new TextEncoder().encode(blob.text);
      } else if (blob?.payload != null && blob.payload.length > 0) {
        bytes = blob.payload;
      } else if ((blob?.location === "cold" || row.location === "cold") && coldStore) {
        const text = await coldStore.get(row.payloadSha256);
        if (text !== null && sha256Hex(text) === row.payloadSha256) {
          bytes = new TextEncoder().encode(text);
          await deps.exec(rehydrateSql, [bytes, row.payloadSha256]);
        }
      }
    }
    if (bytes === null) continue;
    out.push({ payloadSha256: row.payloadSha256, bytes });
  }
  return out;
}

export function resolveTipPayloadText(rows: readonly TipOutboxLwwRow[]): string[] {
  const out: string[] = [];
  for (const row of rows) {
    if (row.blobText != null) {
      out.push(row.blobText);
      continue;
    }
    if (row.blobBytes !== null && row.blobBytes.length > 0) {
      out.push(utf8Decode(row.blobBytes));
    }
  }
  return out;
}
