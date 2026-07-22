import {
  MemoriesClient,
  MemoriesClientAsync,
  type MergeMemoryParams,
  type SearchParams,
  searchAsync,
} from "@khoralabs/memories-node";
import {
  collectNamespaceUmapInput,
  encodeUmapInput,
  type NamespaceUmapInput,
  UMAP_INPUT_CONTENT_TYPE,
  UMAP_INPUT_ENCODING_HEADER,
  type UmapInputCompression,
  type UmapInputScope,
} from "@khoralabs/memories-node/projections/umap-input";
import type { MemoryMutationAttribution } from "@khoralabs/memories-node/provenance";
import type { LabelSchemaMap, OntologyDefinition } from "@khoralabs/memories-ontologies";
import {
  type DatabaseCapabilitiesResponse,
  type DatabaseDeleteMemoryRequest,
  type DatabaseEdgePreviewRequest,
  type DatabaseMergeRequest,
  type DatabaseNamespacesRequest,
  type DatabaseSearchRequest,
  type DatabaseSourceMapTextPreviewRequest,
  type DatabaseUmapInputRequest,
  type DatabaseVectorDimensionsRequest,
  serializeSearchHit,
} from "../client/index";
import type { MemoriesDatabaseHandle, MemoriesDatabaseService } from "../service/index";

import { HttpError, type MemoriesServiceHttpOptions, parseDatabaseIdBody } from "./handlers";

const GLOBAL_ROOT = "_global_";

async function ensureScopeChain(
  handle: MemoriesDatabaseHandle,
  scopePaths: readonly string[],
): Promise<void> {
  if (scopePaths.length === 0) return;
  const op = { now: Date.now() };
  if (handle.sync !== undefined) {
    const persistence = handle.sync.syncPersistence;
    persistence.withTransaction(() => {
      persistence.upsertScope(op, { scopeId: scopePaths[0] ?? GLOBAL_ROOT });
      for (let i = 0; i < scopePaths.length - 1; i++) {
        const parent = scopePaths[i];
        const child = scopePaths[i + 1];
        if (parent === undefined || child === undefined) continue;
        persistence.linkScopes(op, { parentScopeId: parent, childScopeId: child });
      }
    });
    return;
  }

  await handle.persistence.withTransaction(async () => {
    await handle.persistence.upsertScope(op, { scopeId: scopePaths[0] ?? GLOBAL_ROOT });
    for (let i = 0; i < scopePaths.length - 1; i++) {
      const parent = scopePaths[i];
      const child = scopePaths[i + 1];
      if (parent === undefined || child === undefined) continue;
      await handle.persistence.linkScopes(op, { parentScopeId: parent, childScopeId: child });
    }
  });
}

function permissiveLabelSchema(): LabelSchemaMap[string] {
  return {
    "~standard": {
      version: 1,
      vendor: "memories-service-http",
      validate(value: unknown) {
        if (value === null || typeof value !== "object" || Array.isArray(value)) {
          return { issues: [{ message: "Expected object props" }] };
        }
        return { value: value as Record<string, unknown> };
      },
    },
  };
}

function ontologyFromMergeParams(params: Record<string, unknown>): OntologyDefinition {
  const nodeKinds = new Set<string>();
  const edgeKinds = new Set<string>();

  if (params.kind === "edge") {
    const edge = params.edge as { label?: { kind?: string } } | undefined;
    if (edge?.label?.kind !== undefined) edgeKinds.add(edge.label.kind);
  } else {
    for (const label of (params.labels as Array<{ kind?: string }> | undefined) ?? []) {
      if (label.kind !== undefined) nodeKinds.add(label.kind);
    }
    for (const edge of (params.edges as Array<{ label?: { kind?: string } }> | undefined) ?? []) {
      if (edge.label?.kind !== undefined) edgeKinds.add(edge.label.kind);
    }
  }

  const nodeLabels = Object.fromEntries(
    [...nodeKinds].map((kind) => [kind, permissiveLabelSchema()]),
  ) as LabelSchemaMap;
  const edgeLabels = Object.fromEntries(
    [...edgeKinds].map((kind) => [kind, permissiveLabelSchema()]),
  ) as LabelSchemaMap;
  return { nodeLabels, edgeLabels };
}

function parseDatabaseScopedBody(body: unknown): {
  database: ReturnType<typeof parseDatabaseIdBody>;
} {
  if (body === null || typeof body !== "object") {
    throw new HttpError("Request body must be a JSON object", 400);
  }
  const record = body as Record<string, unknown>;
  const database = parseDatabaseIdBody(record.database);
  return { database, ...(record as object) };
}

async function getHandle(
  service: MemoriesDatabaseService,
  body: unknown,
): Promise<{
  database: ReturnType<typeof parseDatabaseIdBody>;
  handle: MemoriesDatabaseHandle;
}> {
  const scoped = parseDatabaseScopedBody(body);
  const handle = await service.getHandle(scoped.database);
  return { database: scoped.database, handle };
}

function parseUmapInputScope(value: unknown): UmapInputScope {
  if (value === undefined) return "exact";
  if (value === "exact" || value === "subtree") return value;
  throw new HttpError('scope must be "exact" or "subtree"', 400);
}

function parseUmapInputCompression(value: unknown): UmapInputCompression {
  if (value === undefined) return "gzip";
  if (value === "gzip" || value === "none") return value;
  throw new HttpError('compression must be "gzip" or "none"', 400);
}

function responseFromEncodedUmapInput(
  payload: Uint8Array,
  compression: UmapInputCompression,
): Response {
  return new Response(payload, {
    headers: {
      "content-type": UMAP_INPUT_CONTENT_TYPE,
      [UMAP_INPUT_ENCODING_HEADER]: compression,
    },
  });
}

export async function handleDatabaseSearch(
  service: MemoriesDatabaseService,
  body: unknown,
): Promise<Response> {
  const scoped = body as DatabaseSearchRequest;
  const { database, handle } = await getHandle(service, scoped);
  if (scoped.params === undefined) {
    throw new HttpError("params is required", 400);
  }
  const result = await searchAsync(
    { persistence: handle.persistence },
    scoped.params as unknown as SearchParams,
  );
  return Response.json({
    hits: result.hits.map(serializeSearchHit),
    ...(result.vectorSearchMethod !== undefined
      ? { vectorSearchMethod: result.vectorSearchMethod }
      : {}),
    database,
  });
}

function stripRemoteAttribution<T extends object>(params: T): Omit<T, "attribution"> {
  const { attribution: _clientSuppliedAttribution, ...safeParams } = params as T & {
    attribution?: unknown;
  };
  return safeParams;
}

export async function handleDatabaseMerge(
  service: MemoriesDatabaseService,
  body: unknown,
  serverAttribution?: MemoryMutationAttribution,
): Promise<Response> {
  const scoped = body as DatabaseMergeRequest & { intentSnapshotId?: string };
  const { database, handle } = await getHandle(service, scoped);
  if (scoped.params === undefined || typeof scoped.params !== "object") {
    throw new HttpError("params is required", 400);
  }
  const safeParams = stripRemoteAttribution(
    scoped.params as MergeMemoryParams,
  ) as MergeMemoryParams;
  const intentSnapshotId =
    typeof scoped.intentSnapshotId === "string" ? scoped.intentSnapshotId : undefined;
  const attribution: MergeMemoryParams["attribution"] =
    serverAttribution !== undefined || intentSnapshotId !== undefined
      ? {
          ...(serverAttribution !== undefined ? serverAttribution : {}),
          ...(intentSnapshotId !== undefined ? { intentSnapshotId } : {}),
        }
      : undefined;
  const params: MergeMemoryParams = {
    ...safeParams,
    ...(attribution !== undefined ? { attribution } : {}),
  };
  const ontology = ontologyFromMergeParams(scoped.params);

  let memoryIds: string[];
  if (handle.sync !== undefined) {
    const client = new MemoriesClient(handle.sync.syncPersistence, ontology);
    memoryIds = client.mergeMemory(params);
  } else {
    const client = new MemoriesClientAsync(handle.persistence, ontology);
    memoryIds = await client.mergeMemory(params);
  }

  return Response.json({ memoryIds, database });
}

export async function handleDatabaseDeleteMemory(
  service: MemoriesDatabaseService,
  body: unknown,
  serverAttribution?: MemoryMutationAttribution,
): Promise<Response> {
  const scoped = body as DatabaseDeleteMemoryRequest & { intentSnapshotId?: string };
  const { database, handle } = await getHandle(service, scoped);
  if (typeof scoped.namespace !== "string" || typeof scoped.key !== "string") {
    throw new HttpError("namespace and key are required", 400);
  }
  const intentSnapshotId =
    typeof scoped.intentSnapshotId === "string" ? scoped.intentSnapshotId : undefined;
  const attribution: MemoryMutationAttribution | undefined =
    serverAttribution !== undefined || intentSnapshotId !== undefined
      ? {
          ...(serverAttribution !== undefined ? serverAttribution : {}),
          ...(intentSnapshotId !== undefined ? { intentSnapshotId } : {}),
        }
      : undefined;

  const deleteParams = {
    namespace: scoped.namespace,
    key: scoped.key,
    ...(attribution !== undefined ? { attribution } : {}),
  };

  if (handle.sync !== undefined) {
    const client = new MemoriesClient(handle.sync.syncPersistence, {
      nodeLabels: {},
      edgeLabels: {},
    });
    client.deleteMemory(deleteParams);
  } else {
    const client = new MemoriesClientAsync(handle.persistence, { nodeLabels: {}, edgeLabels: {} });
    await client.deleteMemory(deleteParams);
  }

  return Response.json({ ok: true, database });
}

export async function handleDatabaseProvenanceHead(
  service: MemoriesDatabaseService,
  body: unknown,
): Promise<Response> {
  const { database, handle } = await getHandle(service, body);
  const fn = handle.persistence.getProvenanceHeadRootHex;
  const rootHex = fn === undefined ? undefined : await Promise.resolve(fn.call(handle.persistence));
  return Response.json({ rootHex: rootHex ?? "", database });
}

export async function handleDatabaseCapabilities(
  service: MemoriesDatabaseService,
  body: unknown,
): Promise<Response> {
  const { database, handle } = await getHandle(service, body);
  const response: DatabaseCapabilitiesResponse = {
    capabilities: handle.persistence.capabilities as Record<string, boolean | undefined>,
  };
  return Response.json({ ...response, database });
}

export async function handleDatabaseNamespaces(
  service: MemoriesDatabaseService,
  body: unknown,
): Promise<Response> {
  const scoped = body as DatabaseNamespacesRequest;
  const { database, handle } = await getHandle(service, scoped);
  const namespaces = await handle.persistence.listMemoryNamespaces();
  return Response.json({ namespaces, database });
}

export async function handleDatabaseEdgePreview(
  service: MemoriesDatabaseService,
  body: unknown,
): Promise<Response> {
  const scoped = body as DatabaseEdgePreviewRequest;
  const { database, handle } = await getHandle(service, scoped);
  if (typeof scoped.namespace !== "string" || typeof scoped.edgeId !== "string") {
    throw new HttpError("namespace and edgeId are required", 400);
  }
  const link = await handle.persistence.loadGraphEdge(
    scoped.namespace.trim(),
    scoped.edgeId.trim(),
  );
  if (link === null) {
    throw new HttpError("edge not found in namespace", 404);
  }
  return Response.json({
    edgeId: link.edgeId,
    fromKey: link.fromKey,
    toKey: link.toKey,
    labels: link.labels,
    properties: link.properties ?? null,
    database,
  });
}

export async function handleDatabaseSourceMapTextPreview(
  service: MemoriesDatabaseService,
  body: unknown,
): Promise<Response> {
  const scoped = body as DatabaseSourceMapTextPreviewRequest;
  const { database, handle } = await getHandle(service, scoped);
  if (typeof scoped.sourceMapId !== "string" || scoped.sourceMapId.trim().length === 0) {
    throw new HttpError("sourceMapId is required", 400);
  }
  const maxChars = scoped.maxChars ?? 2400;
  const text = await handle.persistence.getSourceMapTextPreview(
    scoped.sourceMapId.trim(),
    maxChars,
  );
  return Response.json({ text, database });
}

export async function handleDatabaseVectorDimensions(
  service: MemoriesDatabaseService,
  body: unknown,
): Promise<Response> {
  const scoped = body as DatabaseVectorDimensionsRequest;
  const { database, handle } = await getHandle(service, scoped);
  const dimensions = await handle.persistence.listVectorEmbeddingIndexDimensions();
  return Response.json({ dimensions, database });
}

export async function handleDatabaseUmapInput(
  service: MemoriesDatabaseService,
  projectionSource: MemoriesServiceHttpOptions["projectionSource"],
  body: unknown,
): Promise<Response> {
  if (projectionSource === undefined) {
    throw new HttpError("Projection source is not configured", 501);
  }
  const scoped = body as DatabaseUmapInputRequest;
  const { database, handle } = await getHandle(service, scoped);
  if (typeof scoped.namespace !== "string" || scoped.namespace.trim().length === 0) {
    throw new HttpError("namespace is required", 400);
  }
  const source = await projectionSource({ database, handle });
  if (source === undefined) {
    throw new HttpError("Projection source is not configured for this backend", 501);
  }

  const namespace = scoped.namespace.trim();
  const scope = parseUmapInputScope(scoped.scope);
  const compression = parseUmapInputCompression(scoped.compression);
  const provenanceHeadRootHex =
    scoped.includeProvenanceHead === true
      ? ((await handle.persistence.getProvenanceHeadRootHex()) ?? undefined)
      : undefined;

  const input: NamespaceUmapInput = await collectNamespaceUmapInput(
    source,
    handle.persistence,
    namespace,
    {
      provenanceHeadRootHex,
      scope,
    },
  );
  const payload = await encodeUmapInput(input, { compression });
  return responseFromEncodedUmapInput(payload, compression);
}

export async function handleDatabaseEnsureScopeChain(
  service: MemoriesDatabaseService,
  body: unknown,
): Promise<Response> {
  const scoped = body as { database?: unknown; scopePaths?: unknown };
  const { database, handle } = await getHandle(service, scoped);
  if (!Array.isArray(scoped.scopePaths)) {
    throw new HttpError("scopePaths must be an array", 400);
  }
  const scopePaths = scoped.scopePaths.filter((path): path is string => typeof path === "string");
  await ensureScopeChain(handle, scopePaths);
  return Response.json({ ok: true, database });
}

export async function handleDatabaseFindMemoryId(
  service: MemoriesDatabaseService,
  body: unknown,
): Promise<Response> {
  const scoped = body as { database?: unknown; namespace?: unknown; key?: unknown };
  const { database, handle } = await getHandle(service, scoped);
  if (typeof scoped.namespace !== "string" || typeof scoped.key !== "string") {
    throw new HttpError("namespace and key are required", 400);
  }
  const memoryId = await handle.persistence.findMemoryIdByKey(
    scoped.namespace.trim(),
    scoped.key.trim(),
  );
  return Response.json({ memoryId: memoryId ?? null, database });
}

export async function handleDatabaseLoadMemoryNamespaceKey(
  service: MemoriesDatabaseService,
  body: unknown,
): Promise<Response> {
  const scoped = body as { database?: unknown; memoryId?: unknown };
  const { database, handle } = await getHandle(service, scoped);
  if (typeof scoped.memoryId !== "string" || scoped.memoryId.trim().length === 0) {
    throw new HttpError("memoryId is required", 400);
  }
  const loaded = await handle.persistence.loadMemoryNamespaceKey(scoped.memoryId.trim());
  return Response.json({ record: loaded ?? null, database });
}
