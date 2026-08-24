import type { LwwArmRow } from "../models/content-outbox-sql";
import { buildTipOutboxAppend } from "./append";
import { utf8Bytes, utf8Decode } from "./payload";
import { buildTipOutboxLwwQuery, UNIFIED_TIP_TABLES } from "./replay-sql";
import type { TipOutboxLwwRow } from "./types";

/** Bind params for unified `memory_tip_outbox` INSERT (content facet) from TipOutbox append. */
export function unifiedContentOutboxInsertParams(
  input: Parameters<typeof buildTipOutboxAppend>[0],
): { outboxParams: unknown[]; hotBlob?: { sha256: string; payload: Uint8Array } } {
  const built = buildTipOutboxAppend(input);
  const outboxParams = [
    built.outbox.id,
    built.outbox.now,
    built.outbox.rootHex,
    built.outbox.facet,
    built.outbox.eventType,
    built.outbox.namespace,
    built.outbox.memoryKey,
    built.outbox.sourceKey,
    built.outbox.edgeId,
    built.outbox.payloadSha256,
  ];
  if (built.hotBlob) {
    return {
      outboxParams,
      hotBlob: { sha256: built.hotBlob.sha256, payload: built.hotBlob.payload },
    };
  }
  return { outboxParams };
}

export function buildContentLwwQuery(
  rootHex: string,
  scope: { namespace: string; memoryKey: string } | null,
): { sql: string; params: unknown[] } {
  if (scope === null) {
    return buildTipOutboxLwwQuery(rootHex, { facet: "content" }, UNIFIED_TIP_TABLES);
  }
  return buildTipOutboxLwwQuery(
    rootHex,
    { facet: "content", namespace: scope.namespace, memoryKey: scope.memoryKey },
    UNIFIED_TIP_TABLES,
  );
}

export function tipOutboxRowToLwwArm(row: TipOutboxLwwRow): LwwArmRow {
  let blobText = row.blobText;
  if (blobText == null && row.blobBytes != null) {
    blobText = utf8Decode(row.blobBytes);
  }
  return {
    namespace: row.namespace,
    memoryKey: row.memoryKey,
    sourceKey: row.sourceKey ?? "",
    contentSha256: row.payloadSha256,
    blobText,
    location: row.location,
    coldUri: row.coldUri,
  };
}

export function mergeEntriesToAppendInputs(
  input: {
    root_hex: string;
    namespace: string;
    memoryKey: string;
    entries: ReadonlyArray<{ sourceKey: string; text?: string }>;
  },
  now: number,
): Array<Parameters<typeof buildTipOutboxAppend>[0]> {
  return input.entries.map((entry) => ({
    rootHex: input.root_hex,
    facet: "content" as const,
    eventType: "MERGE_MEMORY" as const,
    keys: {
      namespace: input.namespace,
      memoryKey: input.memoryKey,
      sourceKey: entry.sourceKey,
    },
    payload: entry.text !== undefined ? utf8Bytes(entry.text) : undefined,
    now,
    rowId: `${input.root_hex}:${entry.sourceKey}`,
  }));
}

export function deleteEntryToAppendInput(
  input: { root_hex: string; namespace: string; memoryKey: string },
  now: number,
): Parameters<typeof buildTipOutboxAppend>[0] {
  return {
    rootHex: input.root_hex,
    facet: "content",
    eventType: "DELETE_MEMORY",
    keys: { namespace: input.namespace, memoryKey: input.memoryKey },
    now,
    rowId: `${input.root_hex}:__delete__`,
  };
}
