import {
  type LwwArmRow,
  SQL_INSERT_CONTENT_OUTBOX,
  SQL_INSERT_HOT_BLOB,
  SQL_REHYDRATE_HOT_BLOB,
  SQL_SELECT_BLOB_BY_SHA,
} from "../models/content-outbox-sql";
import { buildTipOutboxAppend } from "./append";
import { utf8Bytes, utf8Decode } from "./payload";
import { buildTipOutboxLwwQuery, LEGACY_CONTENT_TABLES } from "./replay-sql";
import type { TipOutboxLwwRow } from "./types";

/** Bind params for legacy `memory_content_outbox` INSERT from TipOutbox append. */
export function legacyContentOutboxInsertParams(
  input: Parameters<typeof buildTipOutboxAppend>[0],
): { outboxParams: unknown[]; hotBlob?: { sha256: string; text: string } } {
  const built = buildTipOutboxAppend(input);
  const outboxParams = [
    built.outbox.id,
    built.outbox.now,
    built.outbox.rootHex,
    built.outbox.eventType,
    built.outbox.namespace,
    built.outbox.memoryKey,
    built.outbox.sourceKey,
    null,
    built.outbox.payloadSha256,
  ];
  if (built.hotBlob) {
    return {
      outboxParams,
      hotBlob: { sha256: built.hotBlob.sha256, text: utf8Decode(built.hotBlob.payload) },
    };
  }
  return { outboxParams };
}

export {
  SQL_INSERT_CONTENT_OUTBOX,
  SQL_INSERT_HOT_BLOB,
  SQL_REHYDRATE_HOT_BLOB,
  SQL_SELECT_BLOB_BY_SHA,
};

export function buildLegacyContentLwwQuery(
  rootHex: string,
  scope: { namespace: string; memoryKey: string } | null,
): { sql: string; params: unknown[] } {
  if (scope === null) {
    return buildTipOutboxLwwQuery(rootHex, { facet: "content" }, LEGACY_CONTENT_TABLES);
  }
  return buildTipOutboxLwwQuery(
    rootHex,
    { facet: "content", namespace: scope.namespace, memoryKey: scope.memoryKey },
    LEGACY_CONTENT_TABLES,
  );
}

export function tipOutboxRowToLwwArm(row: TipOutboxLwwRow): LwwArmRow {
  return {
    namespace: row.namespace,
    memoryKey: row.memoryKey,
    sourceKey: row.sourceKey ?? "",
    contentSha256: row.payloadSha256,
    blobText: row.blobText,
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
