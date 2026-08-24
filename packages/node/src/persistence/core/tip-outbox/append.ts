import { validateKeysForFacet } from "./facets";
import { payloadSha256 } from "./payload";
import type { TipOutboxAppendInput } from "./types";

export type TipOutboxInsertParams = {
  id: string;
  now: number;
  rootHex: string;
  facet: TipOutboxAppendInput["facet"];
  eventType: TipOutboxAppendInput["eventType"];
  namespace: string;
  memoryKey: string;
  sourceKey: string | null;
  edgeId: string | null;
  payloadSha256: string | null;
};

/** Build SQL insert bindings for one thin outbox row + optional hot blob. */
export function buildTipOutboxAppend(input: TipOutboxAppendInput): {
  outbox: TipOutboxInsertParams;
  hotBlob?: { sha256: string; payload: Uint8Array };
} {
  validateKeysForFacet(input.facet, input.keys, input.eventType);
  const sha = input.payload !== undefined ? payloadSha256(input.payload) : null;
  const outbox: TipOutboxInsertParams = {
    id: input.rowId,
    now: input.now,
    rootHex: input.rootHex,
    facet: input.facet,
    eventType: input.eventType,
    namespace: input.keys.namespace ?? "",
    memoryKey: input.keys.memoryKey ?? "",
    sourceKey: input.keys.sourceKey ?? null,
    edgeId: input.keys.edgeId ?? null,
    payloadSha256: sha,
  };
  if (input.payload !== undefined) {
    return { outbox, hotBlob: { sha256: sha as string, payload: input.payload } };
  }
  return { outbox };
}
