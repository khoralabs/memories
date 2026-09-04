import type { MemoriesBackendCapabilities } from "@khoralabs/memories-node";
import type { MemoriesDatabaseService } from "../service/index";
import { buildAtTipWire } from "./at-tip-wire";
import type {
  DatabaseEdgeDetailResponse,
  DatabaseMemoryDetailResponse,
  DatabaseProvenanceGraphResponse,
  DatabaseProvenanceVectorsResponse,
  TipAtRootWire,
  TipGraphSnapshotWire,
} from "./contracts/wire";
import { HttpError } from "./handlers";
import {
  edgePreviewForHandle,
  getHandle,
  listProvenanceEventsForHandle,
  memoryPreviewForHandle,
} from "./persistence-handlers";

const ROOT_HEX_RE = /^[0-9a-fA-F]{64}$/;

function tipReplayEnabled(caps: MemoriesBackendCapabilities | undefined): boolean {
  return caps?.tipReplayAtRootHex === true;
}

async function resolveRootHex(
  handle: Awaited<ReturnType<typeof getHandle>>["handle"],
  explicit?: unknown,
): Promise<string | undefined> {
  if (typeof explicit === "string" && explicit.trim().length > 0) {
    const trimmed = explicit.trim();
    if (!ROOT_HEX_RE.test(trimmed)) {
      throw new HttpError("rootHex must be a 64-char hex string", 400);
    }
    return trimmed;
  }
  const head = handle.persistence.getProvenanceHeadRootHex;
  if (head === undefined) return undefined;
  return (await Promise.resolve(head.call(handle.persistence))) ?? undefined;
}

function requireTipReplay(caps: MemoriesBackendCapabilities | undefined): void {
  if (!tipReplayEnabled(caps)) {
    throw new HttpError("Tip replay at rootHex is not supported for this database backend", 501);
  }
}

export async function handleDatabaseProvenanceGraph(
  service: MemoriesDatabaseService,
  body: unknown,
): Promise<Response> {
  const scoped = body as {
    database?: unknown;
    rootHex?: unknown;
    namespace?: unknown;
    key?: unknown;
  };
  const { database, handle } = await getHandle(service, scoped);
  const caps = handle.persistence.capabilities as MemoriesBackendCapabilities | undefined;
  requireTipReplay(caps);
  const rootHex = await resolveRootHex(handle, scoped.rootHex);
  if (rootHex === undefined) {
    throw new HttpError("rootHex is required when provenance head is empty", 400);
  }
  if (typeof scoped.namespace !== "string" || scoped.namespace.trim().length === 0) {
    throw new HttpError("namespace is required", 400);
  }
  if (typeof scoped.key !== "string" || scoped.key.trim().length === 0) {
    throw new HttpError("key is required", 400);
  }
  const namespace = scoped.namespace.trim();
  const key = scoped.key.trim();
  const fn = handle.persistence.getMemoryGraphAtRootHexAsync;
  if (fn === undefined) {
    throw new HttpError("Tip replay at rootHex is not supported for this database backend", 501);
  }
  const graph = await fn.call(handle.persistence, rootHex, namespace, key);
  const response: DatabaseProvenanceGraphResponse = {
    rootHex,
    graph: graph as TipGraphSnapshotWire | null,
    database,
  };
  return Response.json(response);
}

export async function handleDatabaseProvenanceVectors(
  service: MemoriesDatabaseService,
  body: unknown,
): Promise<Response> {
  const scoped = body as {
    database?: unknown;
    rootHex?: unknown;
    namespace?: unknown;
    key?: unknown;
    includeValues?: unknown;
  };
  const { database, handle } = await getHandle(service, scoped);
  const caps = handle.persistence.capabilities as MemoriesBackendCapabilities | undefined;
  requireTipReplay(caps);
  const rootHex = await resolveRootHex(handle, scoped.rootHex);
  if (rootHex === undefined) {
    throw new HttpError("rootHex is required when provenance head is empty", 400);
  }
  if (typeof scoped.namespace !== "string" || scoped.namespace.trim().length === 0) {
    throw new HttpError("namespace is required", 400);
  }
  if (typeof scoped.key !== "string" || scoped.key.trim().length === 0) {
    throw new HttpError("key is required", 400);
  }
  const namespace = scoped.namespace.trim();
  const key = scoped.key.trim();
  const includeValues = scoped.includeValues === true;
  const fn = handle.persistence.getMemoryVectorAtRootHexAsync;
  if (fn === undefined) {
    throw new HttpError("Tip replay at rootHex is not supported for this database backend", 501);
  }
  const arms = await fn.call(handle.persistence, rootHex, namespace, key);
  const vectors = arms.map((arm) => ({
    sourceKey: arm.sourceKey,
    dimensions: arm.vector.length,
    ...(includeValues ? { values: arm.vector } : {}),
  }));
  const response: DatabaseProvenanceVectorsResponse = { rootHex, vectors, database };
  return Response.json(response);
}

export async function handleDatabaseMemoryDetail(
  service: MemoriesDatabaseService,
  body: unknown,
): Promise<Response> {
  const scoped = body as {
    database?: unknown;
    namespace?: unknown;
    key?: unknown;
    rootHex?: unknown;
    limit?: unknown;
    before?: unknown;
    includeVectors?: unknown;
    maxChars?: unknown;
  };
  const { database, handle } = await getHandle(service, scoped);
  if (typeof scoped.namespace !== "string" || typeof scoped.key !== "string") {
    throw new HttpError("namespace and key are required", 400);
  }
  const namespace = scoped.namespace.trim();
  const key = scoped.key.trim();
  if (namespace.length === 0 || key.length === 0) {
    throw new HttpError("namespace and key are required", 400);
  }
  const rootHex = await resolveRootHex(handle, scoped.rootHex);
  const preview = await memoryPreviewForHandle(handle, {
    namespace,
    key,
    ...(scoped.maxChars !== undefined ? { maxChars: scoped.maxChars as number } : {}),
  });
  const events = await listProvenanceEventsForHandle(handle, {
    namespace,
    key,
    ...(scoped.limit !== undefined ? { limit: scoped.limit } : {}),
    ...(scoped.before !== undefined ? { before: scoped.before } : {}),
  });
  const atTip = await buildAtTipWire(
    handle,
    rootHex,
    namespace,
    key,
    scoped.includeVectors === true,
  );
  const response: DatabaseMemoryDetailResponse = {
    database,
    ...(rootHex !== undefined ? { rootHex } : {}),
    preview,
    atTip,
    events,
  };
  return Response.json(response);
}

export async function handleDatabaseEdgeDetail(
  service: MemoriesDatabaseService,
  body: unknown,
): Promise<Response> {
  const scoped = body as {
    database?: unknown;
    namespace?: unknown;
    edgeId?: unknown;
    rootHex?: unknown;
    limit?: unknown;
    before?: unknown;
    includeVectors?: unknown;
    includeSuppressed?: unknown;
  };
  const { database, handle } = await getHandle(service, scoped);
  if (typeof scoped.namespace !== "string" || typeof scoped.edgeId !== "string") {
    throw new HttpError("namespace and edgeId are required", 400);
  }
  const namespace = scoped.namespace.trim();
  const edgeId = scoped.edgeId.trim();
  if (namespace.length === 0 || edgeId.length === 0) {
    throw new HttpError("namespace and edgeId are required", 400);
  }
  const rootHex = await resolveRootHex(handle, scoped.rootHex);
  const preview = await edgePreviewForHandle(handle, {
    namespace,
    edgeId,
    ...(scoped.includeSuppressed === true ? { includeSuppressed: true } : {}),
  });
  const edgeKeyFn = handle.persistence.findMemoryKeyByEdgeId;
  const edgeKey =
    edgeKeyFn === undefined
      ? undefined
      : await Promise.resolve(edgeKeyFn.call(handle.persistence, namespace, edgeId));
  let atTip: TipAtRootWire = { content: null, graph: null, vectors: null };
  if (rootHex !== undefined && edgeKey !== undefined) {
    atTip = await buildAtTipWire(
      handle,
      rootHex,
      namespace,
      edgeKey,
      scoped.includeVectors === true,
    );
  }
  const events = await listProvenanceEventsForHandle(handle, {
    namespace,
    ...(edgeKey !== undefined ? { key: edgeKey } : {}),
    edgeId,
    ...(scoped.limit !== undefined ? { limit: scoped.limit } : {}),
    ...(scoped.before !== undefined ? { before: scoped.before } : {}),
  });
  const response: DatabaseEdgeDetailResponse = {
    database,
    ...(rootHex !== undefined ? { rootHex } : {}),
    preview,
    atTip,
    events,
  };
  return Response.json(response);
}
