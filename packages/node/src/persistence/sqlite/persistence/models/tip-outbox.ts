import type { Database } from "bun:sqlite";
import { buildTipOutboxAppend } from "../../../../persistence/core/tip-outbox/append";
import {
  encodeTipGraphSnapshot,
  type TipGraphSnapshotV1,
} from "../../../../persistence/core/tip-outbox/graph-snapshot";
import {
  SQL_INSERT_TIP_BLOB_HOT,
  SQL_INSERT_TIP_OUTBOX,
  SQL_SELECT_TIP_BLOB,
  SQL_UPSERT_TIP_BLOB_REHYDRATE,
} from "../../../../persistence/core/tip-outbox/replay-sql";
import type { TipOutboxEventType } from "../../../../persistence/core/tip-outbox/types";
import type { DbCtx } from "./context";
import { loadGraphEdge, loadGraphNode } from "./graph-index";
import { findMemoryAssociation, isMemorySuppressed } from "./memories";

function upsertHotTipBlob(db: Database, sha256: string, payload: Uint8Array, now: number): void {
  const existing = db
    .query<{ location: string; payload: Uint8Array | null }, [string]>(SQL_SELECT_TIP_BLOB)
    .get(sha256);
  if (existing === null || existing === undefined) {
    db.run(SQL_INSERT_TIP_BLOB_HOT, [sha256, payload, now]);
    return;
  }
  if (existing.location !== "hot" || existing.payload == null) {
    db.run(SQL_UPSERT_TIP_BLOB_REHYDRATE, [payload, sha256]);
  }
}

export function captureGraphSnapshot(
  ctx: DbCtx,
  namespace: string,
  memoryKey: string,
): TipGraphSnapshotV1 | null {
  const assoc = findMemoryAssociation(ctx, namespace, memoryKey);
  if (assoc === undefined) return null;
  const suppressed = isMemorySuppressed(ctx, assoc.memoryId);
  if (assoc.kind === "node") {
    const node = loadGraphNode(ctx.db, namespace, memoryKey, { includeSuppressed: true });
    if (!node) return null;
    return {
      v: 1,
      kind: "node",
      namespace,
      memoryKey,
      suppressed: suppressed || node.suppressed === true,
      labels: node.labels,
      properties: node.properties ?? null,
    };
  }
  const edge = loadGraphEdge(ctx.db, namespace, assoc.edgeId, { includeSuppressed: true });
  if (!edge) return null;
  return {
    v: 1,
    kind: "edge",
    namespace,
    memoryKey,
    edgeId: assoc.edgeId,
    suppressed: suppressed || edge.suppressed === true,
    labels: edge.labels,
    properties: edge.properties ?? null,
    endpoints: { fromKey: edge.fromKey, toKey: edge.toKey },
  };
}

export function appendGraphFacetOutbox(
  ctx: DbCtx,
  input: {
    root_hex: string;
    event_type: TipOutboxEventType;
    namespace: string;
    memoryKey: string;
    edgeId?: string | null;
  },
): void {
  const { now, db } = ctx;
  let edgeId = input.edgeId ?? null;
  if (edgeId === null && input.event_type !== "DELETE_MEMORY") {
    const assoc = findMemoryAssociation(ctx, input.namespace, input.memoryKey);
    edgeId = assoc?.kind === "edge" ? assoc.edgeId : null;
  }
  let payload: Uint8Array | undefined;
  if (input.event_type !== "DELETE_MEMORY") {
    const snapshot = captureGraphSnapshot(ctx, input.namespace, input.memoryKey);
    if (snapshot) payload = encodeTipGraphSnapshot(snapshot);
  }
  const built = buildTipOutboxAppend({
    rootHex: input.root_hex,
    facet: "graph",
    eventType: input.event_type,
    keys: {
      namespace: input.namespace,
      memoryKey: input.memoryKey,
      edgeId: edgeId ?? undefined,
    },
    payload,
    now,
    rowId: `${input.root_hex}:graph:${input.namespace}:${input.memoryKey}`,
  });
  if (built.hotBlob) upsertHotTipBlob(db, built.hotBlob.sha256, built.hotBlob.payload, now);
  db.run(SQL_INSERT_TIP_OUTBOX, [
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
  ]);
}
