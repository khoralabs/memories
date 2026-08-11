import {
  assertNamespaceCountAllowsNew,
  assertNamespacePath,
  assertRenameRespectsMaxNamespaces,
  buildRenameNamespaceMap,
  collectRenameSourceNamespaces,
  MemoriesClient,
  MemoriesClientAsync,
  type MergeMemoryParams,
  NamespaceConstraintError,
  type NamespacePathPolicy,
  namespacePathFromStored,
  namespacePathsFromMetadata,
  resolveNamespacePathPolicy,
  type SearchParams,
  searchAsync,
} from "@khoralabs/memories-node";
import { searchNamespaces } from "@khoralabs/memories-node/helpers";
import type { LabelSchemaMap, OntologyDefinition } from "@khoralabs/memories-node/ontology";
import { buildNamespaceGraphLayoutFromProjectionInput } from "@khoralabs/memories-node/projections";
import {
  collectNamespaceProjectionInput,
  encodeProjectionInput,
  type NamespaceProjectionInput,
  PROJECTION_INPUT_CONTENT_TYPE,
  PROJECTION_INPUT_ENCODING_HEADER,
  type ProjectionInputCompression,
  type ProjectionInputScope,
} from "@khoralabs/memories-node/projections/projection-input";
import type { MemoryMutationAttribution } from "@khoralabs/memories-node/provenance";
import {
  type DatabaseCapabilitiesResponse,
  type DatabaseDeleteMemoryRequest,
  type DatabaseEdgePreviewRequest,
  type DatabaseEffectiveSuppressionRequest,
  type DatabaseGraphCountsRequest,
  type DatabaseGraphLayoutRequest,
  type DatabaseGraphStatsRequest,
  type DatabaseMemoryPreviewRequest,
  type DatabaseMergeRequest,
  type DatabaseNamespaceExistsUnderPrefixRequest,
  type DatabaseNamespacesRequest,
  type DatabaseNamespacesUnderPrefixRequest,
  type DatabaseProjectionInputRequest,
  type DatabaseSearchNamespacesRequest,
  type DatabaseSearchRequest,
  type DatabaseSourceMapReplaceRequest,
  type DatabaseSourceMapTextPreviewRequest,
  type DatabaseSourceMapTextRequest,
  type DatabaseSuppressMemoryRequest,
  type DatabaseSuppressNamespaceRequest,
  type DatabaseUnsuppressMemoryRequest,
  type DatabaseUnsuppressNamespaceRequest,
  type DatabaseVectorDimensionsRequest,
  serializeSearchHit,
} from "../client/index";
import type { MemoriesDatabaseService } from "../service/index";
import type {
  MemoriesDatabaseHandle,
  MemoriesDatabaseId,
  MemoriesDatabaseOntologyStore,
  StoredOntologyJsonSchema,
} from "../storage/core/index";

import { HttpError, type MemoriesServiceHttpOptions, parseDatabaseIdBody } from "./handlers";
import { labelMapsFromStoredOntology } from "./stored-ontology-label-schema";
import { assertHttpVectorPayload } from "./vector-payload";

const GLOBAL_ROOT = "_global_";

export function namespacePathPolicyFromHttpOpts(opts: {
  maxNamespaceDepth?: number;
  maxNamespacePathLength?: number;
}): NamespacePathPolicy {
  return resolveNamespacePathPolicy({
    ...(opts.maxNamespaceDepth !== undefined ? { maxDepth: opts.maxNamespaceDepth } : {}),
    ...(opts.maxNamespacePathLength !== undefined
      ? { maxLength: opts.maxNamespacePathLength }
      : {}),
  });
}

function mapNamespaceConstraint(error: unknown): never {
  if (error instanceof NamespaceConstraintError) {
    throw new HttpError(error.message, 400);
  }
  throw error;
}

async function enforceMaxNamespaces(
  handle: MemoriesDatabaseHandle,
  namespace: string,
  maxNamespaces: number | undefined,
): Promise<void> {
  if (maxNamespaces === undefined) return;
  const listed = namespacePathsFromMetadata(await handle.persistence.listNamespacesWithMetadata());
  assertNamespaceCountAllowsNew(listed, namespace, maxNamespaces);
}
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

/** Permissive object props schema when no linked ontology (or unknown kind). */
function permissiveLabelSchema(): LabelSchemaMap[string] {
  const objectJsonSchema: Record<string, unknown> = {
    type: "object",
    additionalProperties: true,
  };
  // Cast: StandardSchemaV1 typing omits optional StandardJSONSchemaV1.jsonSchema.
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
      // Required by mergeMemory → catalogSchemaJsonFor* → propsSchemaToJson
      jsonSchema: {
        input: () => objectJsonSchema,
        output: () => objectJsonSchema,
      },
    },
  } as LabelSchemaMap[string];
}

function collectMergeLabelKinds(params: Record<string, unknown>): {
  nodeKinds: Set<string>;
  edgeKinds: Set<string>;
} {
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

  return { nodeKinds, edgeKinds };
}

/**
 * Build a merge-time ontology for the request kinds.
 * Prefer schemas from the DB-linked stored ontology; fall back to permissive for
 * missing registry, missing link, or kinds not present on the linked document.
 */
export function ontologyFromMergeParams(
  params: Record<string, unknown>,
  linked?: StoredOntologyJsonSchema,
): OntologyDefinition {
  const { nodeKinds, edgeKinds } = collectMergeLabelKinds(params);
  const linkedMaps = linked !== undefined ? labelMapsFromStoredOntology(linked) : undefined;

  const nodeLabels = Object.fromEntries(
    [...nodeKinds].map((kind) => [kind, linkedMaps?.nodeLabels[kind] ?? permissiveLabelSchema()]),
  ) as LabelSchemaMap;
  const edgeLabels = Object.fromEntries(
    [...edgeKinds].map((kind) => [kind, linkedMaps?.edgeLabels[kind] ?? permissiveLabelSchema()]),
  ) as LabelSchemaMap;
  return { nodeLabels, edgeLabels };
}

async function resolveLinkedOntology(
  ontologyStore: MemoriesDatabaseOntologyStore | undefined,
  database: MemoriesDatabaseId,
): Promise<StoredOntologyJsonSchema | undefined> {
  if (ontologyStore === undefined) return undefined;
  const link = await ontologyStore.getCurrentLink(database);
  if (link === undefined) return undefined;
  return ontologyStore.getOntology(link.hash);
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

function parseProjectionInputScope(value: unknown): ProjectionInputScope {
  if (value === undefined) return "exact";
  if (value === "exact" || value === "subtree") return value;
  throw new HttpError('scope must be "exact" or "subtree"', 400);
}

function parseProjectionInputCompression(value: unknown): ProjectionInputCompression {
  if (value === undefined) return "gzip";
  if (value === "gzip" || value === "none") return value;
  throw new HttpError('compression must be "gzip" or "none"', 400);
}

function responseFromEncodedProjectionInput(
  payload: Uint8Array,
  compression: ProjectionInputCompression,
): Response {
  return new Response(payload, {
    headers: {
      "content-type": PROJECTION_INPUT_CONTENT_TYPE,
      [PROJECTION_INPUT_ENCODING_HEADER]: compression,
    },
  });
}

export async function handleDatabaseSearch(
  service: MemoriesDatabaseService,
  body: unknown,
): Promise<Response> {
  const scoped = body as DatabaseSearchRequest;
  if (scoped.params === undefined) {
    throw new HttpError("params is required", 400);
  }
  const content = scoped.params.content as { vector?: unknown } | undefined;
  if (content !== undefined && "vector" in content && content.vector !== undefined) {
    assertHttpVectorPayload(content.vector, "params.content.vector");
  }
  const { database, handle } = await getHandle(service, scoped);
  const result = await searchAsync(
    { persistence: handle.persistence, telemetry: handle.telemetry },
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

export async function handleDatabaseSearchNamespaces(
  service: MemoriesDatabaseService,
  body: unknown,
): Promise<Response> {
  const scoped = body as DatabaseSearchNamespacesRequest;
  const { database, handle } = await getHandle(service, scoped);
  if (typeof scoped.query !== "string") {
    throw new HttpError("query is required", 400);
  }
  const query = scoped.query.trim();
  const under =
    typeof scoped.under === "string" && scoped.under.trim().length > 0
      ? scoped.under.trim()
      : undefined;
  const namespace =
    typeof scoped.namespace === "string" && scoped.namespace.trim().length > 0
      ? scoped.namespace.trim()
      : (under ?? "_global_");

  const emptyOntology = { nodeLabels: {}, edgeLabels: {} } as const;
  const client =
    handle.sync !== undefined
      ? new MemoriesClient(handle.sync.syncPersistence, emptyOntology, {
          telemetry: handle.telemetry,
        })
      : new MemoriesClientAsync(handle.persistence, emptyOntology, {
          telemetry: handle.telemetry,
        });

  const queryVector =
    scoped.vector !== undefined ? assertHttpVectorPayload(scoped.vector, "vector") : undefined;
  const arms = resolveHttpSearchNamespacesArms(scoped.arms, queryVector !== undefined);
  const result = await searchNamespaces(
    client,
    { namespace },
    {
      content: queryVector !== undefined ? { text: query, vector: queryVector } : { text: query },
      arms,
      ...(under !== undefined ? { under } : {}),
      ...(scoped.limit !== undefined ? { limit: scoped.limit } : {}),
      ...(scoped.nodeTopK !== undefined ? { nodeTopK: scoped.nodeTopK } : {}),
      ...(scoped.includeSuppressed === true ? { includeSuppressed: true } : {}),
    },
  );

  return Response.json({
    query: result.query,
    under: result.under,
    namespaces: result.namespaces,
    database,
  });
}

/**
 * This HTTP route is embedding-agnostic. Never let omitted `arms.vector` default to 1
 * inside {@link searchNamespaces} without a client-supplied query vector.
 */
function resolveHttpSearchNamespacesArms(
  arms: DatabaseSearchNamespacesRequest["arms"],
  hasQueryVector: boolean,
): { nodes: number; lexical: number; vector: number } {
  if (arms === undefined) {
    return {
      nodes: 1,
      lexical: 1,
      vector: hasQueryVector ? 1 : 0,
    };
  }
  const vectorWeight = arms.vector !== undefined ? Math.max(0, arms.vector) : 0;
  if (vectorWeight > 0 && !hasQueryVector) {
    throw new HttpError(
      "search-namespaces does not support vector arm without a client-supplied query vector; set arms.vector to 0 or omit it",
      400,
    );
  }
  return {
    nodes: arms.nodes !== undefined ? Math.max(0, arms.nodes) : 1,
    lexical: arms.lexical !== undefined ? Math.max(0, arms.lexical) : 1,
    vector: vectorWeight,
  };
}

function stripRemoteAttribution<T extends object>(params: T): Omit<T, "attribution"> {
  const { attribution: _clientSuppliedAttribution, ...safeParams } = params as T & {
    attribution?: unknown;
  };
  return safeParams;
}

function assertMergeVectorPayloads(params: Record<string, unknown>): void {
  const content = params.content;
  if (Array.isArray(content)) {
    for (let i = 0; i < content.length; i++) {
      const item = content[i];
      if (item !== null && typeof item === "object" && "vector" in item) {
        const vector = (item as { vector?: unknown }).vector;
        if (vector !== undefined) {
          assertHttpVectorPayload(vector, `params.content[${i}].vector`);
        }
      }
    }
  }
  const searchMetaVector = params.searchMetaVector;
  if (searchMetaVector !== undefined) {
    assertHttpVectorPayload(searchMetaVector, "params.searchMetaVector");
  }
}

export async function handleDatabaseMerge(
  service: MemoriesDatabaseService,
  body: unknown,
  serverAttribution?: MemoryMutationAttribution,
  ontologyStore?: MemoriesDatabaseOntologyStore,
  maxNamespaces?: number,
  pathPolicy?: NamespacePathPolicy,
): Promise<Response> {
  const scoped = body as DatabaseMergeRequest & { intentSnapshotId?: string };
  if (scoped.params === undefined || typeof scoped.params !== "object") {
    throw new HttpError("params is required", 400);
  }
  assertMergeVectorPayloads(scoped.params);
  const { database, handle } = await getHandle(service, scoped);
  const safeParams = stripRemoteAttribution(
    scoped.params as MergeMemoryParams,
  ) as MergeMemoryParams;
  const policy = pathPolicy ?? resolveNamespacePathPolicy();
  try {
    const namespace = assertNamespacePath(String(safeParams.namespace ?? ""), policy);
    await enforceMaxNamespaces(handle, namespace, maxNamespaces);
  } catch (error) {
    mapNamespaceConstraint(error);
  }
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
  const linked = await resolveLinkedOntology(ontologyStore, database);
  const ontology = ontologyFromMergeParams(scoped.params, linked);

  let memoryIds: string[];
  try {
    if (handle.sync !== undefined) {
      const client = new MemoriesClient(handle.sync.syncPersistence, ontology, {
        telemetry: handle.telemetry,
        namespacePathPolicy: policy,
      });
      memoryIds = client.mergeMemory(params);
    } else {
      const client = new MemoriesClientAsync(handle.persistence, ontology, {
        telemetry: handle.telemetry,
        namespacePathPolicy: policy,
      });
      memoryIds = await client.mergeMemory(params);
    }
  } catch (error) {
    if (error instanceof NamespaceConstraintError || error instanceof RangeError) {
      throw new HttpError(error.message, 400);
    }
    throw error;
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
    const client = new MemoriesClient(
      handle.sync.syncPersistence,
      {
        nodeLabels: {},
        edgeLabels: {},
      },
      { telemetry: handle.telemetry },
    );
    client.deleteMemory(deleteParams);
  } else {
    const client = new MemoriesClientAsync(
      handle.persistence,
      { nodeLabels: {}, edgeLabels: {} },
      { telemetry: handle.telemetry },
    );
    await client.deleteMemory(deleteParams);
  }

  return Response.json({ ok: true, database });
}

async function handleSuppressToggle(
  service: MemoriesDatabaseService,
  body: unknown,
  serverAttribution: MemoryMutationAttribution | undefined,
  mode: "suppress" | "unsuppress",
): Promise<Response> {
  const scoped = body as (DatabaseSuppressMemoryRequest | DatabaseUnsuppressMemoryRequest) & {
    intentSnapshotId?: string;
  };
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

  const params = {
    namespace: scoped.namespace,
    key: scoped.key,
    ...(attribution !== undefined ? { attribution } : {}),
  };

  if (handle.sync !== undefined) {
    const client = new MemoriesClient(
      handle.sync.syncPersistence,
      {
        nodeLabels: {},
        edgeLabels: {},
      },
      { telemetry: handle.telemetry },
    );
    if (mode === "suppress") client.suppressMemory(params);
    else client.unsuppressMemory(params);
  } else {
    const client = new MemoriesClientAsync(
      handle.persistence,
      { nodeLabels: {}, edgeLabels: {} },
      { telemetry: handle.telemetry },
    );
    if (mode === "suppress") await client.suppressMemory(params);
    else await client.unsuppressMemory(params);
  }

  return Response.json({ ok: true, database });
}

export async function handleDatabaseSuppressMemory(
  service: MemoriesDatabaseService,
  body: unknown,
  serverAttribution?: MemoryMutationAttribution,
): Promise<Response> {
  return handleSuppressToggle(service, body, serverAttribution, "suppress");
}

export async function handleDatabaseUnsuppressMemory(
  service: MemoriesDatabaseService,
  body: unknown,
  serverAttribution?: MemoryMutationAttribution,
): Promise<Response> {
  return handleSuppressToggle(service, body, serverAttribution, "unsuppress");
}

async function handleNamespaceSuppressToggle(
  service: MemoriesDatabaseService,
  body: unknown,
  serverAttribution: MemoryMutationAttribution | undefined,
  mode: "suppress" | "unsuppress",
): Promise<Response> {
  const scoped = body as (DatabaseSuppressNamespaceRequest | DatabaseUnsuppressNamespaceRequest) & {
    intentSnapshotId?: string;
  };
  const { database, handle } = await getHandle(service, scoped);
  if (typeof scoped.namespace !== "string") {
    throw new HttpError("namespace is required", 400);
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

  const params = {
    namespace: scoped.namespace,
    ...(attribution !== undefined ? { attribution } : {}),
  };

  if (handle.sync !== undefined) {
    const client = new MemoriesClient(
      handle.sync.syncPersistence,
      {
        nodeLabels: {},
        edgeLabels: {},
      },
      { telemetry: handle.telemetry },
    );
    if (mode === "suppress") client.suppressNamespace(params);
    else client.unsuppressNamespace(params);
  } else {
    const client = new MemoriesClientAsync(
      handle.persistence,
      { nodeLabels: {}, edgeLabels: {} },
      { telemetry: handle.telemetry },
    );
    if (mode === "suppress") await client.suppressNamespace(params);
    else await client.unsuppressNamespace(params);
  }

  return Response.json({ ok: true, database });
}

export async function handleDatabaseSuppressNamespace(
  service: MemoriesDatabaseService,
  body: unknown,
  serverAttribution?: MemoryMutationAttribution,
): Promise<Response> {
  return handleNamespaceSuppressToggle(service, body, serverAttribution, "suppress");
}

export async function handleDatabaseUnsuppressNamespace(
  service: MemoriesDatabaseService,
  body: unknown,
  serverAttribution?: MemoryMutationAttribution,
): Promise<Response> {
  return handleNamespaceSuppressToggle(service, body, serverAttribution, "unsuppress");
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

export async function handleDatabaseProvenanceTimestamp(
  service: MemoriesDatabaseService,
  body: unknown,
): Promise<Response> {
  const scoped = body as { database?: unknown; rootHex?: unknown };
  const { database, handle } = await getHandle(service, scoped);
  if (typeof scoped.rootHex !== "string" || scoped.rootHex.trim().length === 0) {
    throw new HttpError("rootHex is required", 400);
  }
  const fn = handle.persistence.getProvenanceTimestampMsForRootHex;
  if (fn === undefined) {
    return Response.json({ timestampMs: null, database });
  }
  const timestampMs = await Promise.resolve(fn.call(handle.persistence, scoped.rootHex.trim()));
  return Response.json({
    timestampMs:
      typeof timestampMs === "number" && Number.isFinite(timestampMs) ? timestampMs : null,
    database,
  });
}

const ROOT_HEX_RE = /^[0-9a-fA-F]{64}$/;

function parseProvenanceListLimit(raw: unknown, fallback = 50): number {
  if (raw === undefined) return fallback;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 1) {
    throw new HttpError("limit must be a positive number", 400);
  }
  return Math.min(Math.floor(raw), 100);
}

export async function handleDatabaseProvenanceEvents(
  service: MemoriesDatabaseService,
  body: unknown,
): Promise<Response> {
  const scoped = body as {
    database?: unknown;
    namespace?: unknown;
    key?: unknown;
    limit?: unknown;
    before?: unknown;
  };
  const { database, handle } = await getHandle(service, scoped);
  if (scoped.key !== undefined && scoped.namespace === undefined) {
    throw new HttpError("key requires namespace", 400);
  }
  if (scoped.namespace !== undefined && typeof scoped.namespace !== "string") {
    throw new HttpError("namespace must be a string", 400);
  }
  if (scoped.key !== undefined && typeof scoped.key !== "string") {
    throw new HttpError("key must be a string", 400);
  }
  let before: { createdAt: number; id: string } | undefined;
  if (scoped.before !== undefined) {
    const b = scoped.before as { createdAt?: unknown; id?: unknown };
    if (
      typeof b.createdAt !== "number" ||
      !Number.isFinite(b.createdAt) ||
      typeof b.id !== "string" ||
      b.id.length === 0
    ) {
      throw new HttpError("before must be { createdAt: number, id: string }", 400);
    }
    before = { createdAt: b.createdAt, id: b.id };
  }
  const fn = handle.persistence.listProvenanceEvents;
  if (fn === undefined) {
    return Response.json({ events: [], database });
  }
  const limit = parseProvenanceListLimit(scoped.limit);
  const events = await Promise.resolve(
    fn.call(handle.persistence, {
      ...(typeof scoped.namespace === "string" ? { namespace: scoped.namespace } : {}),
      ...(typeof scoped.key === "string" ? { key: scoped.key } : {}),
      limit,
      ...(before !== undefined ? { before } : {}),
    }),
  );
  const last = events.at(-1);
  return Response.json({
    events,
    ...(events.length === limit && last !== undefined
      ? { nextBefore: { createdAt: last.createdAt, id: last.id } }
      : {}),
    database,
  });
}

export async function handleDatabaseProvenanceChain(
  service: MemoriesDatabaseService,
  body: unknown,
): Promise<Response> {
  const scoped = body as {
    database?: unknown;
    limit?: unknown;
    beforeRootHex?: unknown;
  };
  const { database, handle } = await getHandle(service, scoped);
  if (scoped.beforeRootHex !== undefined) {
    if (
      typeof scoped.beforeRootHex !== "string" ||
      !ROOT_HEX_RE.test(scoped.beforeRootHex.trim())
    ) {
      throw new HttpError("beforeRootHex must be a 64-char hex string", 400);
    }
  }
  const fn = handle.persistence.listProvenanceChain;
  if (fn === undefined) {
    return Response.json({ links: [], database });
  }
  const limit = parseProvenanceListLimit(scoped.limit);
  const beforeRootHex =
    typeof scoped.beforeRootHex === "string" ? scoped.beforeRootHex.trim() : undefined;
  const links = await Promise.resolve(
    fn.call(handle.persistence, {
      limit,
      ...(beforeRootHex !== undefined ? { beforeRootHex } : {}),
    }),
  );
  const last = links.at(-1);
  return Response.json({
    links,
    ...(links.length === limit && last !== undefined ? { nextBeforeRootHex: last.rootHex } : {}),
    database,
  });
}

export async function handleDatabaseProvenanceContent(
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
  if (typeof scoped.rootHex !== "string" || !ROOT_HEX_RE.test(scoped.rootHex.trim())) {
    throw new HttpError("rootHex must be a 64-char hex string", 400);
  }
  if (typeof scoped.namespace !== "string" || scoped.namespace.trim().length === 0) {
    throw new HttpError("namespace is required", 400);
  }
  if (typeof scoped.key !== "string" || scoped.key.trim().length === 0) {
    throw new HttpError("key is required", 400);
  }
  const rootHex = scoped.rootHex.trim();
  const namespace = scoped.namespace.trim();
  const key = scoped.key.trim();

  const persistence = handle.persistence as {
    getMemoryContentAtRootHex?: (
      rootHex: string,
      namespace: string,
      memoryKey: string,
    ) =>
      | Array<{ sourceKey: string; text: string }>
      | Promise<Array<{ sourceKey: string; text: string }>>;
    getMemoryContentAtRootHexAsync?: (
      rootHex: string,
      namespace: string,
      memoryKey: string,
    ) => Promise<Array<{ sourceKey: string; text: string }>>;
  };

  let content: Array<{ sourceKey: string; text: string }> = [];
  if (typeof persistence.getMemoryContentAtRootHexAsync === "function") {
    content = await persistence.getMemoryContentAtRootHexAsync(rootHex, namespace, key);
  } else if (typeof persistence.getMemoryContentAtRootHex === "function") {
    content = await Promise.resolve(persistence.getMemoryContentAtRootHex(rootHex, namespace, key));
  }
  return Response.json({
    rootHex,
    content: content.map((c) => ({ sourceKey: c.sourceKey, text: c.text })),
    database,
  });
}

export async function handleDatabaseCapabilities(
  service: MemoriesDatabaseService,
  body: unknown,
  pathPolicy?: NamespacePathPolicy,
): Promise<Response> {
  const { database, handle } = await getHandle(service, body);
  const limits = resolveNamespacePathPolicy(pathPolicy);
  const response: DatabaseCapabilitiesResponse = {
    capabilities: handle.persistence.capabilities as Record<string, boolean | undefined>,
    namespaceLimits: { maxDepth: limits.maxDepth, maxLength: limits.maxLength },
  };
  return Response.json({ ...response, database });
}

function toNamespaceWire(row: {
  namespace: string;
  alias: string | null;
  description: string;
  suppressed?: boolean;
}): { namespace: string; alias: string | null; description: string; suppressed: boolean } {
  return {
    namespace: row.namespace,
    alias: row.alias,
    description: row.description,
    suppressed: row.suppressed === true,
  };
}

export async function handleDatabaseNamespaces(
  service: MemoriesDatabaseService,
  body: unknown,
): Promise<Response> {
  const scoped = body as DatabaseNamespacesRequest;
  const { database, handle } = await getHandle(service, scoped);
  const namespaces = (
    await handle.persistence.listNamespacesWithMetadata(
      scoped.includeSuppressed === true ? { includeSuppressed: true } : undefined,
    )
  ).map(toNamespaceWire);
  return Response.json({ namespaces, database });
}

export async function handleDatabaseNamespacesUnderPrefix(
  service: MemoriesDatabaseService,
  body: unknown,
): Promise<Response> {
  const scoped = body as DatabaseNamespacesUnderPrefixRequest;
  const { database, handle } = await getHandle(service, scoped);
  if (typeof scoped.prefix !== "string" || scoped.prefix.trim().length === 0) {
    throw new HttpError("prefix is required", 400);
  }
  let prefix: string;
  try {
    prefix = namespacePathFromStored(scoped.prefix.trim());
  } catch (error) {
    mapNamespaceConstraint(error);
  }
  const namespaces = (
    await handle.persistence.listNamespacesWithMetadataUnderPrefix(
      prefix,
      scoped.includeSuppressed === true ? { includeSuppressed: true } : undefined,
    )
  ).map(toNamespaceWire);
  return Response.json({ namespaces, database });
}

export async function handleDatabaseNamespaceExistsUnderPrefix(
  service: MemoriesDatabaseService,
  body: unknown,
): Promise<Response> {
  const scoped = body as DatabaseNamespaceExistsUnderPrefixRequest;
  const { database, handle } = await getHandle(service, scoped);
  if (typeof scoped.prefix !== "string" || scoped.prefix.trim().length === 0) {
    throw new HttpError("prefix is required", 400);
  }
  let prefix: string;
  try {
    prefix = namespacePathFromStored(scoped.prefix.trim());
  } catch (error) {
    mapNamespaceConstraint(error);
  }
  const exists = await handle.persistence.namespaceExistsUnderPrefix(
    prefix,
    scoped.includeSuppressed === true ? { includeSuppressed: true } : undefined,
  );
  return Response.json({ exists, database });
}

export async function handleDatabaseNamespaceGet(
  service: MemoriesDatabaseService,
  body: unknown,
): Promise<Response> {
  const scoped = body as { database?: unknown; namespace?: unknown };
  const { database, handle } = await getHandle(service, scoped);
  if (typeof scoped.namespace !== "string" || scoped.namespace.trim().length === 0) {
    throw new HttpError("namespace is required", 400);
  }
  const namespace = await handle.persistence.getNamespaceMetadata(scoped.namespace.trim());
  return Response.json({
    namespace: namespace === undefined ? null : toNamespaceWire(namespace),
    database,
  });
}

export async function handleDatabaseNamespaceUpsert(
  service: MemoriesDatabaseService,
  body: unknown,
  maxNamespaces?: number,
  pathPolicy?: NamespacePathPolicy,
): Promise<Response> {
  const scoped = body as {
    database?: unknown;
    namespace?: unknown;
    alias?: unknown;
    description?: unknown;
  };
  const { database, handle } = await getHandle(service, scoped);
  if (typeof scoped.namespace !== "string" || scoped.namespace.trim().length === 0) {
    throw new HttpError("namespace is required", 400);
  }
  const policy = pathPolicy ?? resolveNamespacePathPolicy();
  let namespace: string;
  try {
    namespace = assertNamespacePath(scoped.namespace.trim(), policy);
    await enforceMaxNamespaces(handle, namespace, maxNamespaces);
  } catch (error) {
    mapNamespaceConstraint(error);
  }
  const parseOptionalStringOrNull = (value: unknown, field: string): string | null | undefined => {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (typeof value === "string") return value;
    throw new HttpError(`${field} must be a string or null`, 400);
  };
  const alias = parseOptionalStringOrNull(scoped.alias, "alias");
  const description =
    scoped.description === undefined
      ? undefined
      : typeof scoped.description === "string"
        ? scoped.description
        : undefined;
  if (scoped.description !== undefined && description === undefined) {
    throw new HttpError("description must be a string", 400);
  }

  const op = { now: Date.now() };
  const input = {
    namespace,
    ...(alias !== undefined ? { alias } : {}),
    ...(description !== undefined ? { description } : {}),
  };

  try {
    if (handle.sync !== undefined) {
      const persistence = handle.sync.syncPersistence;
      persistence.withTransaction(() => {
        persistence.upsertNamespaceMetadata(op, input);
      });
    } else {
      await handle.persistence.withTransaction(async () => {
        await handle.persistence.upsertNamespaceMetadata(op, input);
      });
    }
  } catch (error) {
    if (error instanceof NamespaceConstraintError) {
      throw new HttpError(error.message, 400);
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new HttpError(message, 400);
  }

  const meta = await handle.persistence.getNamespaceMetadata(namespace);
  if (meta === undefined) {
    throw new HttpError("namespace metadata missing after upsert", 500);
  }
  return Response.json({ namespace: toNamespaceWire(meta), database });
}

export async function handleDatabaseNamespaceDelete(
  service: MemoriesDatabaseService,
  body: unknown,
): Promise<Response> {
  const scoped = body as {
    database?: unknown;
    namespace?: unknown;
    recursive?: unknown;
  };
  const { database, handle } = await getHandle(service, scoped);
  if (typeof scoped.namespace !== "string" || scoped.namespace.trim().length === 0) {
    throw new HttpError("namespace is required", 400);
  }
  let namespace: string;
  try {
    namespace = namespacePathFromStored(scoped.namespace.trim());
  } catch (error) {
    mapNamespaceConstraint(error);
  }
  const recursive = scoped.recursive !== false;
  const params = { namespace, recursive };

  try {
    let result: { namespaces: string[]; deletedMemories: number };
    if (handle.sync !== undefined) {
      const client = new MemoriesClient(
        handle.sync.syncPersistence,
        { nodeLabels: {}, edgeLabels: {} },
        { telemetry: handle.telemetry },
      );
      result = client.deleteNamespace(params);
    } else {
      const client = new MemoriesClientAsync(
        handle.persistence,
        { nodeLabels: {}, edgeLabels: {} },
        { telemetry: handle.telemetry },
      );
      result = await client.deleteNamespace(params);
    }
    return Response.json({ ...result, database });
  } catch (error) {
    if (error instanceof NamespaceConstraintError) {
      throw new HttpError(error.message, 400);
    }
    throw error;
  }
}

export async function handleDatabaseNamespaceRename(
  service: MemoriesDatabaseService,
  body: unknown,
  maxNamespaces?: number,
  pathPolicy?: NamespacePathPolicy,
): Promise<Response> {
  const scoped = body as {
    database?: unknown;
    from?: unknown;
    to?: unknown;
    recursive?: unknown;
  };
  const { database, handle } = await getHandle(service, scoped);
  if (typeof scoped.from !== "string" || scoped.from.trim().length === 0) {
    throw new HttpError("from is required", 400);
  }
  if (typeof scoped.to !== "string" || scoped.to.trim().length === 0) {
    throw new HttpError("to is required", 400);
  }
  const policy = pathPolicy ?? resolveNamespacePathPolicy();
  let from: string;
  let to: string;
  try {
    from = namespacePathFromStored(scoped.from.trim());
    to = assertNamespacePath(scoped.to.trim(), policy);
  } catch (error) {
    mapNamespaceConstraint(error);
  }
  const recursive = scoped.recursive !== false;

  try {
    const listed = namespacePathsFromMetadata(
      await handle.persistence.listNamespacesWithMetadata(),
    );
    const sources = collectRenameSourceNamespaces(listed, from, recursive);
    const nsMap = buildRenameNamespaceMap(sources, from, to);
    assertRenameRespectsMaxNamespaces(listed, nsMap, maxNamespaces);
  } catch (error) {
    mapNamespaceConstraint(error);
  }

  const params = { from, to, recursive };
  try {
    let result: {
      namespaces: Array<{ from: string; to: string }>;
      renamedMemories: number;
    };
    if (handle.sync !== undefined) {
      const client = new MemoriesClient(
        handle.sync.syncPersistence,
        { nodeLabels: {}, edgeLabels: {} },
        { telemetry: handle.telemetry },
      );
      result = client.renameNamespace(params);
    } else {
      const client = new MemoriesClientAsync(
        handle.persistence,
        { nodeLabels: {}, edgeLabels: {} },
        { telemetry: handle.telemetry },
      );
      result = await client.renameNamespace(params);
    }
    return Response.json({ ...result, database });
  } catch (error) {
    if (error instanceof NamespaceConstraintError) {
      throw new HttpError(error.message, 400);
    }
    const message = error instanceof Error ? error.message : String(error);
    if (/collision|namespace rename/i.test(message)) {
      throw new HttpError(message, 400);
    }
    throw error;
  }
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
    scoped.includeSuppressed === true ? { includeSuppressed: true } : undefined,
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
    suppressed: link.suppressed === true,
    database,
  });
}

export async function handleDatabaseMemoryPreview(
  service: MemoriesDatabaseService,
  body: unknown,
): Promise<Response> {
  const scoped = body as DatabaseMemoryPreviewRequest;
  const { database, handle } = await getHandle(service, scoped);
  if (typeof scoped.namespace !== "string" || typeof scoped.key !== "string") {
    throw new HttpError("namespace and key are required", 400);
  }
  const namespace = scoped.namespace.trim();
  const key = scoped.key.trim();
  if (namespace.length === 0 || key.length === 0) {
    throw new HttpError("namespace and key are required", 400);
  }
  const memoryId = await handle.persistence.findMemoryIdByKey(namespace, key);
  if (memoryId === undefined) {
    throw new HttpError("memory not found", 404);
  }
  const maxChars = scoped.maxChars ?? 2400;
  const labels = await handle.persistence.loadNodeLabelsForMemory(namespace, key);
  const inventory = await handle.persistence.listSourceMapInventoryForMemory(memoryId, 32);
  const content = await Promise.all(
    inventory.map(async (item) => {
      const text = item.hasText
        ? await handle.persistence.getSourceMapTextPreview(item.sourceMapId, maxChars)
        : null;
      return {
        sourceKey: item.sourceKey,
        sourceMapId: item.sourceMapId,
        text,
        hasText: item.hasText,
        hasVector: item.hasVector,
        ...(item.contentHash !== undefined ? { contentHash: item.contentHash } : {}),
        createdAt: item.createdAt,
      };
    }),
  );
  const suppressed = await handle.persistence.isMemorySuppressed(memoryId);
  const properties = await handle.persistence.loadNodePropertiesForMemory(namespace, key);
  return Response.json({
    key,
    namespace,
    labels,
    content,
    properties: properties ?? null,
    suppressed,
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

export async function handleDatabaseSourceMapText(
  service: MemoriesDatabaseService,
  body: unknown,
): Promise<Response> {
  const scoped = body as DatabaseSourceMapTextRequest;
  const { database, handle } = await getHandle(service, scoped);
  if (typeof scoped.sourceMapId !== "string" || scoped.sourceMapId.trim().length === 0) {
    throw new HttpError("sourceMapId is required", 400);
  }
  const text = await handle.persistence.getSourceMapText(scoped.sourceMapId.trim());
  return Response.json({ text, database });
}

export async function handleDatabaseSourceMapReplace(
  service: MemoriesDatabaseService,
  body: unknown,
  serverAttribution?: MemoryMutationAttribution,
  pathPolicy?: NamespacePathPolicy,
): Promise<Response> {
  const scoped = body as DatabaseSourceMapReplaceRequest & { intentSnapshotId?: string };
  const { database, handle } = await getHandle(service, scoped);
  if (typeof scoped.namespace !== "string" || typeof scoped.key !== "string") {
    throw new HttpError("namespace and key are required", 400);
  }
  if (typeof scoped.sourceKey !== "string" || scoped.sourceKey.trim().length === 0) {
    throw new HttpError("sourceKey is required", 400);
  }
  const namespace = scoped.namespace.trim();
  const key = scoped.key.trim();
  const sourceKey = scoped.sourceKey.trim();
  if (namespace.length === 0 || key.length === 0) {
    throw new HttpError("namespace and key are required", 400);
  }
  if (scoped.text === undefined && scoped.vector === undefined) {
    throw new HttpError("text and/or vector is required", 400);
  }
  if (scoped.vector !== undefined) {
    assertHttpVectorPayload(scoped.vector, "vector");
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

  const policy = pathPolicy ?? resolveNamespacePathPolicy();
  const emptyOntology = { nodeLabels: {}, edgeLabels: {} } as const;
  const replaceParams = {
    namespace,
    key,
    sourceKey,
    ...(scoped.text !== undefined ? { text: scoped.text } : {}),
    ...(scoped.vector !== undefined ? { vector: scoped.vector } : {}),
    ...(attribution !== undefined ? { attribution } : {}),
  };

  try {
    let result: { sourceMapId: string; rootHex: string };
    if (handle.sync !== undefined) {
      const client = new MemoriesClient(handle.sync.syncPersistence, emptyOntology, {
        telemetry: handle.telemetry,
        namespacePathPolicy: policy,
      });
      result = client.replaceMemoryFeature(replaceParams);
    } else {
      const client = new MemoriesClientAsync(handle.persistence, emptyOntology, {
        telemetry: handle.telemetry,
        namespacePathPolicy: policy,
      });
      result = await client.replaceMemoryFeature(replaceParams);
    }
    return Response.json({
      sourceMapId: result.sourceMapId,
      rootHex: result.rootHex,
      database,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/memory not found/i.test(msg)) {
      throw new HttpError("memory not found", 404);
    }
    if (e instanceof NamespaceConstraintError || e instanceof RangeError || e instanceof Error) {
      if (/reserved|vectorSearch|content item|ZodError|invalid/i.test(msg)) {
        throw new HttpError(msg, 400);
      }
    }
    throw e;
  }
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

export async function handleDatabaseProjectionInput(
  service: MemoriesDatabaseService,
  projectionSource: MemoriesServiceHttpOptions["projectionSource"],
  body: unknown,
): Promise<Response> {
  if (projectionSource === undefined) {
    throw new HttpError("Projection source is not configured", 501);
  }
  const scoped = body as DatabaseProjectionInputRequest;
  const { database, handle } = await getHandle(service, scoped);
  if (typeof scoped.namespace !== "string" || scoped.namespace.trim().length === 0) {
    throw new HttpError("namespace is required", 400);
  }
  const source = await projectionSource({ database, handle });
  if (source === undefined) {
    throw new HttpError("Projection source is not configured for this backend", 501);
  }

  const namespace = scoped.namespace.trim();
  const scope = parseProjectionInputScope(scoped.scope);
  const compression = parseProjectionInputCompression(scoped.compression);
  const provenanceHeadRootHex =
    scoped.includeProvenanceHead === true
      ? ((await handle.persistence.getProvenanceHeadRootHex()) ?? undefined)
      : undefined;

  const input: NamespaceProjectionInput = await collectNamespaceProjectionInput(
    source,
    handle.persistence,
    namespace,
    {
      provenanceHeadRootHex,
      scope,
      ...(scoped.includeSuppressed === true ? { includeSuppressed: true } : {}),
    },
  );
  const payload = await encodeProjectionInput(input, { compression });
  return responseFromEncodedProjectionInput(payload, compression);
}

/** Ready graph layout JSON from the same projection source as projection-input. */
export async function handleDatabaseGraphLayout(
  service: MemoriesDatabaseService,
  projectionSource: MemoriesServiceHttpOptions["projectionSource"],
  body: unknown,
): Promise<Response> {
  if (projectionSource === undefined) {
    throw new HttpError("Projection source is not configured", 501);
  }
  const scoped = body as DatabaseGraphLayoutRequest;
  const { database, handle } = await getHandle(service, scoped);
  if (typeof scoped.namespace !== "string" || scoped.namespace.trim().length === 0) {
    throw new HttpError("namespace is required", 400);
  }
  const source = await projectionSource({ database, handle });
  if (source === undefined) {
    throw new HttpError("Projection source is not configured for this backend", 501);
  }

  const namespace = scoped.namespace.trim();
  const scope = parseProjectionInputScope(scoped.scope);
  const input: NamespaceProjectionInput = await collectNamespaceProjectionInput(
    source,
    handle.persistence,
    namespace,
    {
      scope,
      ...(scoped.includeSuppressed === true ? { includeSuppressed: true } : {}),
    },
  );
  const layout = buildNamespaceGraphLayoutFromProjectionInput(input, {
    ...(scoped.includeSuppressed === true ? { includeSuppressed: true } : {}),
  });
  return Response.json({ layout, database });
}

function mergeLabelKindMaps(into: Record<string, number>, from: Record<string, number>): void {
  for (const [kind, count] of Object.entries(from)) {
    into[kind] = (into[kind] ?? 0) + count;
  }
}

async function resolveGraphScopeNamespaces(
  handle: MemoriesDatabaseHandle,
  namespace: string,
  scope: ProjectionInputScope,
  includeOpts: { includeSuppressed: true } | undefined,
): Promise<string[]> {
  if (scope === "exact") return [namespace];
  const rows = await handle.persistence.listNamespacesWithMetadataUnderPrefix(
    namespace,
    includeOpts,
  );
  return rows.map((r) => r.namespace);
}

/** Efficient node/edge counts for a namespace (exact or subtree). */
export async function handleDatabaseGraphCounts(
  service: MemoriesDatabaseService,
  body: unknown,
): Promise<Response> {
  const scoped = body as DatabaseGraphCountsRequest;
  const { database, handle } = await getHandle(service, scoped);
  if (typeof scoped.namespace !== "string" || scoped.namespace.trim().length === 0) {
    throw new HttpError("namespace is required", 400);
  }
  const namespace = scoped.namespace.trim();
  const scope = parseProjectionInputScope(scoped.scope);
  const includeOpts =
    scoped.includeSuppressed === true ? { includeSuppressed: true as const } : undefined;
  const namespaces = await resolveGraphScopeNamespaces(handle, namespace, scope, includeOpts);

  let nodeCount = 0;
  let edgeCount = 0;
  for (const ns of namespaces) {
    const part = await handle.persistence.countGraphForNamespace(ns, includeOpts);
    nodeCount += part.nodeCount;
    edgeCount += part.edgeCount;
  }

  return Response.json({
    database,
    namespace,
    scope,
    nodeCount,
    edgeCount,
  });
}

/** Graph profiling stats (counts, suppressed breakdown, label-kind histograms). */
export async function handleDatabaseGraphStats(
  service: MemoriesDatabaseService,
  body: unknown,
): Promise<Response> {
  const scoped = body as DatabaseGraphStatsRequest;
  const { database, handle } = await getHandle(service, scoped);
  if (typeof scoped.namespace !== "string" || scoped.namespace.trim().length === 0) {
    throw new HttpError("namespace is required", 400);
  }
  const namespace = scoped.namespace.trim();
  const scope = parseProjectionInputScope(scoped.scope);
  const includeOpts =
    scoped.includeSuppressed === true ? { includeSuppressed: true as const } : undefined;
  const namespaces = await resolveGraphScopeNamespaces(handle, namespace, scope, includeOpts);

  let nodeCount = 0;
  let edgeCount = 0;
  let suppressedNodeCount = 0;
  let suppressedEdgeCount = 0;
  const labelKinds = { nodes: {} as Record<string, number>, edges: {} as Record<string, number> };

  for (const ns of namespaces) {
    const part = await handle.persistence.statsGraphForNamespace(ns, includeOpts);
    nodeCount += part.nodeCount;
    edgeCount += part.edgeCount;
    suppressedNodeCount += part.suppressedNodeCount;
    suppressedEdgeCount += part.suppressedEdgeCount;
    mergeLabelKindMaps(labelKinds.nodes, part.labelKinds.nodes);
    mergeLabelKindMaps(labelKinds.edges, part.labelKinds.edges);
  }

  return Response.json({
    database,
    namespace,
    scope,
    nodeCount,
    edgeCount,
    suppressedNodeCount,
    suppressedEdgeCount,
    labelKinds,
  });
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
  if (memoryId === undefined) {
    return Response.json({ memoryId: null, database });
  }
  const suppressed = await handle.persistence.isMemorySuppressed(memoryId);
  return Response.json({ memoryId, suppressed, database });
}

export async function handleDatabaseEffectiveSuppression(
  service: MemoriesDatabaseService,
  body: unknown,
): Promise<Response> {
  const scoped = body as DatabaseEffectiveSuppressionRequest;
  const { database, handle } = await getHandle(service, scoped);
  if (typeof scoped.namespace !== "string" || scoped.namespace.trim().length === 0) {
    throw new HttpError("namespace is required", 400);
  }
  const namespace = scoped.namespace.trim();
  const hasKey = scoped.key !== undefined;
  if (hasKey && (typeof scoped.key !== "string" || scoped.key.trim().length === 0)) {
    throw new HttpError("key must be a non-empty string when provided", 400);
  }

  const suppressedBy = await handle.persistence.findClosestSuppressedNamespace(namespace);

  if (!hasKey) {
    const meta = await handle.persistence.getNamespaceMetadata(namespace);
    const exactSuppressed = meta?.suppressed === true;
    return Response.json({
      namespace,
      effectivelySuppressed: suppressedBy != null,
      suppressedBy,
      exactSuppressed,
      database,
    });
  }

  const key = (scoped.key as string).trim();
  const memoryId = await handle.persistence.findMemoryIdByKey(namespace, key);
  if (memoryId === undefined) {
    throw new HttpError("memory not found", 404);
  }
  const exactSuppressed = await handle.persistence.isMemorySuppressed(memoryId);
  return Response.json({
    namespace,
    key,
    effectivelySuppressed: exactSuppressed || suppressedBy != null,
    suppressedBy,
    exactSuppressed,
    database,
  });
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
  const memoryId = scoped.memoryId.trim();
  const loaded = await handle.persistence.loadMemoryNamespaceKey(memoryId);
  if (loaded === undefined) {
    return Response.json({ record: null, database });
  }
  const suppressed = await handle.persistence.isMemorySuppressed(memoryId);
  return Response.json({
    record: { namespace: loaded.namespace, key: loaded.key, suppressed },
    database,
  });
}
