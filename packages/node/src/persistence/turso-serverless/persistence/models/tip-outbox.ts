import { buildTipOutboxAppend } from "../../../../persistence/core/tip-outbox/append";
import {
  encodeTipGraphSnapshot,
  type TipGraphSnapshotV1,
} from "../../../../persistence/core/tip-outbox/graph-snapshot";
import { float32Bytes } from "../../../../persistence/core/tip-outbox/payload";
import {
  SQL_INSERT_TIP_BLOB_HOT,
  SQL_INSERT_TIP_OUTBOX,
  SQL_SELECT_TIP_BLOB,
  SQL_UPSERT_TIP_BLOB_REHYDRATE,
} from "../../../../persistence/core/tip-outbox/replay-sql";
import type { TipOutboxEventType } from "../../../../persistence/core/tip-outbox/types";
import type { DbCtx } from "../context";
import { ctxExec, ctxQueryOne } from "../db";
import { loadGraphEdge, loadGraphNode } from "./graph-index";
import { findMemoryAssociation, isMemorySuppressed } from "./memories";

async function upsertHotTipBlob(ctx: DbCtx, sha256: string, payload: Uint8Array): Promise<void> {
  const existing = await ctxQueryOne<{ location: string; payload: Uint8Array | null }>(
    ctx,
    SQL_SELECT_TIP_BLOB,
    [sha256],
  );
  if (existing === undefined) {
    await ctxExec(ctx, SQL_INSERT_TIP_BLOB_HOT, [sha256, payload, ctx.now]);
    return;
  }
  if (existing.location !== "hot" || existing.payload == null) {
    await ctxExec(ctx, SQL_UPSERT_TIP_BLOB_REHYDRATE, [payload, sha256]);
  }
}

export async function captureGraphSnapshot(
  ctx: DbCtx,
  namespace: string,
  memoryKey: string,
): Promise<TipGraphSnapshotV1 | null> {
  const assoc = await findMemoryAssociation(ctx, namespace, memoryKey);
  if (assoc === undefined) return null;
  const suppressed = await isMemorySuppressed(ctx, assoc.memoryId);
  if (assoc.kind === "node") {
    const node = await loadGraphNode(ctx.db, namespace, memoryKey, { includeSuppressed: true });
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
  const edge = await loadGraphEdge(ctx.db, namespace, assoc.edgeId, { includeSuppressed: true });
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

export async function appendGraphFacetOutbox(
  ctx: DbCtx,
  input: {
    root_hex: string;
    event_type: TipOutboxEventType;
    namespace: string;
    memoryKey: string;
    edgeId?: string | null;
  },
): Promise<void> {
  let edgeId = input.edgeId ?? null;
  if (edgeId === null && input.event_type !== "DELETE_MEMORY") {
    const assoc = await findMemoryAssociation(ctx, input.namespace, input.memoryKey);
    edgeId = assoc?.kind === "edge" ? assoc.edgeId : null;
  }
  let payload: Uint8Array | undefined;
  if (input.event_type !== "DELETE_MEMORY") {
    const snapshot = await captureGraphSnapshot(ctx, input.namespace, input.memoryKey);
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
    now: ctx.now,
    rowId: `${input.root_hex}:graph:${input.namespace}:${input.memoryKey}`,
  });
  if (built.hotBlob) await upsertHotTipBlob(ctx, built.hotBlob.sha256, built.hotBlob.payload);
  await ctxExec(ctx, SQL_INSERT_TIP_OUTBOX, [
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

export async function appendVectorFacetOutbox(
  ctx: DbCtx,
  input: {
    root_hex: string;
    event_type: TipOutboxEventType;
    namespace: string;
    memoryKey: string;
    entries: ReadonlyArray<{ sourceKey: string; vector?: Float32Array }>;
  },
): Promise<void> {
  for (const entry of input.entries) {
    if (input.event_type === "DELETE_MEMORY" || entry.vector === undefined) continue;
    const built = buildTipOutboxAppend({
      rootHex: input.root_hex,
      facet: "vector",
      eventType: "MERGE_MEMORY",
      keys: {
        namespace: input.namespace,
        memoryKey: input.memoryKey,
        sourceKey: entry.sourceKey,
      },
      payload: float32Bytes(Array.from(entry.vector)),
      now: ctx.now,
      rowId: `${input.root_hex}:vector:${entry.sourceKey}`,
    });
    if (built.hotBlob) await upsertHotTipBlob(ctx, built.hotBlob.sha256, built.hotBlob.payload);
    await ctxExec(ctx, SQL_INSERT_TIP_OUTBOX, [
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
  if (input.event_type === "DELETE_MEMORY") {
    const built = buildTipOutboxAppend({
      rootHex: input.root_hex,
      facet: "vector",
      eventType: "DELETE_MEMORY",
      keys: { namespace: input.namespace, memoryKey: input.memoryKey },
      now: ctx.now,
      rowId: `${input.root_hex}:vector:__delete__`,
    });
    await ctxExec(ctx, SQL_INSERT_TIP_OUTBOX, [
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
}
