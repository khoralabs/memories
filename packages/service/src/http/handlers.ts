import type {
  BuildHttpRequestAttestationInput,
  HttpRequestContributorSigner,
} from "@khoralabs/memories-node/attestation";
import { buildHttpRequestAttestation } from "@khoralabs/memories-node/attestation";
import type { GraphProjectionSource } from "@khoralabs/memories-node/projections";
import type { MemoryMutationAttribution } from "@khoralabs/memories-node/provenance";
import {
  type AuthenticatedActor,
  type AuthorizeScope,
  AuthStrategyError,
  type DatabaseAction,
  type MemoriesDatabaseAccessStrategy,
} from "../auth/index";
import type { MemoriesDatabaseService } from "../service/index";
import type {
  DatabaseKind,
  MemoriesDatabaseCatalogStore,
  MemoriesDatabaseHandle,
  MemoriesDatabaseId,
  MemoriesDatabaseOntologyStore,
} from "../storage/core/index";
import {
  handleDatabaseEdgeDetail,
  handleDatabaseMemoryDetail,
  handleDatabaseProvenanceGraph,
  handleDatabaseProvenanceVectors,
} from "./at-tip-handlers";
import {
  scopeDatabase,
  scopeFromMemoryBody,
  scopeFromNamespaceDelete,
  scopeFromNamespaceMutation,
  scopeFromPrefixBody,
  scopeFromRename,
} from "./authorize-scope";
import { MEMORIES_HTTP_PATH } from "./contracts/routes";
import {
  handleDatabaseHash,
  handleDatabaseOntologyCurrent,
  handleDatabaseOntologyHistory,
  handleDatabaseOntologyLink,
  handleOntologyGet,
  handleOntologyListDatabases,
  handleOntologyRegister,
} from "./ontology-handlers";
import {
  handleDatabaseCapabilities,
  handleDatabaseDeleteMemory,
  handleDatabaseEdgePreview,
  handleDatabaseEffectiveSuppression,
  handleDatabaseEnsureScopeChain,
  handleDatabaseFindMemoryId,
  handleDatabaseGraphCounts,
  handleDatabaseGraphLayout,
  handleDatabaseGraphStats,
  handleDatabaseLoadMemoryNamespaceKey,
  handleDatabaseMemoryPreview,
  handleDatabaseMerge,
  handleDatabaseNamespaceDelete,
  handleDatabaseNamespaceExistsUnderPrefix,
  handleDatabaseNamespaceGet,
  handleDatabaseNamespaceRename,
  handleDatabaseNamespaces,
  handleDatabaseNamespacesUnderPrefix,
  handleDatabaseNamespaceUpsert,
  handleDatabaseProjectionInput,
  handleDatabaseProvenanceChain,
  handleDatabaseProvenanceContent,
  handleDatabaseProvenanceEvents,
  handleDatabaseProvenanceHead,
  handleDatabaseProvenanceTimestamp,
  handleDatabaseSearch,
  handleDatabaseSearchNamespaces,
  handleDatabaseSourceMapReplace,
  handleDatabaseSourceMapText,
  handleDatabaseSourceMapTextPreview,
  handleDatabaseSuppressMemory,
  handleDatabaseSuppressNamespace,
  handleDatabaseUnsuppressMemory,
  handleDatabaseUnsuppressNamespace,
  handleDatabaseVectorDimensions,
  namespacePathPolicyFromHttpOpts,
} from "./persistence-handlers";

export type DatabaseIdBody = {
  kind: DatabaseKind;
  ownerKey: string;
};

export function parseDatabaseIdBody(body: unknown): MemoriesDatabaseId {
  if (body === null || typeof body !== "object") {
    throw new HttpError("Request body must be a JSON object", 400);
  }
  const record = body as Record<string, unknown>;
  if (typeof record.kind !== "string" || typeof record.ownerKey !== "string") {
    throw new HttpError("Body must include string kind and ownerKey", 400);
  }
  return { kind: record.kind, ownerKey: record.ownerKey };
}

export class HttpError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export type HttpAttributionOptions = {
  sign: HttpRequestContributorSigner;
  principalForActor?: (actor: AuthenticatedActor) => string;
  keyId?: string;
  alg?: string;
  now?: () => Date;
};

export type MemoriesServiceHttpOptions = {
  service: MemoriesDatabaseService;
  auth: MemoriesDatabaseAccessStrategy;
  ontology?: MemoriesDatabaseOntologyStore;
  catalog?: MemoriesDatabaseCatalogStore;
  /**
   * Cap on distinct namespaces (memories ∪ metadata). `undefined` = unlimited.
   * Enforced on merge and namespace metadata upsert when introducing a new path.
   */
  maxNamespaces?: number;
  /** Host write max namespace path depth (segments). Default 6; clamped to absolute max. */
  maxNamespaceDepth?: number;
  /** Host write max namespace path length (chars). Default 512; clamped to absolute max. */
  maxNamespacePathLength?: number;
  projectionSource?: (input: {
    database: MemoriesDatabaseId;
    handle: MemoriesDatabaseHandle;
  }) => GraphProjectionSource | Promise<GraphProjectionSource | undefined>;
  attribution?: HttpAttributionOptions;
};

function requireOntology(opts: MemoriesServiceHttpOptions): MemoriesDatabaseOntologyStore {
  if (opts.ontology === undefined) {
    throw new HttpError("Ontology registry is not configured", 501);
  }
  return opts.ontology;
}

function requireCatalog(opts: MemoriesServiceHttpOptions): MemoriesDatabaseCatalogStore {
  if (opts.catalog === undefined) {
    throw new HttpError("Database catalog is not configured", 501);
  }
  return opts.catalog;
}

type ParsedJsonRequest = {
  body: unknown;
  bodySha256: string;
};

async function readJsonBody(req: Request): Promise<ParsedJsonRequest> {
  const text = await req.text();
  const normalized = text.trim().length === 0 ? "{}" : text;
  let body: unknown;
  try {
    body = JSON.parse(normalized) as unknown;
  } catch {
    throw new HttpError("Invalid JSON body", 400);
  }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
  const bodySha256 = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/u, "");
  return { body, bodySha256 };
}

async function authorize(
  auth: MemoriesDatabaseAccessStrategy,
  req: Request,
  action: DatabaseAction,
  database?: MemoriesDatabaseId,
  scope: AuthorizeScope = scopeDatabase(),
): Promise<AuthenticatedActor> {
  const actor = await auth.authenticate(req);
  await auth.authorize({
    actor,
    action,
    scope,
    ...(database !== undefined ? { database } : {}),
  });
  return actor;
}

async function buildRequestAttribution(
  opts: HttpAttributionOptions,
  actor: AuthenticatedActor,
  req: Request,
  bodySha256: string,
): Promise<MemoryMutationAttribution> {
  const url = new URL(req.url);
  const principal =
    opts.principalForActor !== undefined
      ? opts.principalForActor(actor)
      : `${actor.scheme}:${actor.subject}`;
  const buildInput: BuildHttpRequestAttestationInput = {
    principal,
    method: req.method,
    path: url.pathname,
    bodySha256,
    sign: opts.sign,
    issuedAt: (opts.now !== undefined ? opts.now() : new Date()).toISOString(),
    ...(opts.alg !== undefined ? { alg: opts.alg } : {}),
    ...(opts.keyId !== undefined ? { keyId: opts.keyId } : {}),
  };
  const contributor = await buildHttpRequestAttestation(buildInput);
  return { contributor };
}

export async function handleMemoriesServiceHttpRequest(
  req: Request,
  opts: MemoriesServiceHttpOptions,
): Promise<Response> {
  const url = new URL(req.url);

  try {
    if (req.method === "GET" && url.pathname === MEMORIES_HTTP_PATH.databases) {
      await authorize(opts.auth, req, "manage");
      const kind = url.searchParams.get("kind") ?? undefined;
      const ids = await opts.service.list(kind ? { kind } : undefined);
      const databases = await Promise.all(
        ids.map(async (id) => {
          const meta = opts.catalog !== undefined ? await opts.catalog.get(id) : undefined;
          return {
            id,
            name: meta?.name ?? "",
            description: meta?.description ?? "",
          };
        }),
      );
      return jsonResponse({ databases });
    }

    if (req.method === "POST" && url.pathname === MEMORIES_HTTP_PATH.databasesOpen) {
      const { body } = await readJsonBody(req);
      const id = parseDatabaseIdBody(body);
      await authorize(opts.auth, req, "read", id);
      await opts.service.open(id);
      const record = body as Record<string, unknown>;
      const name = typeof record.name === "string" ? record.name : undefined;
      const description = typeof record.description === "string" ? record.description : undefined;
      if ((name !== undefined || description !== undefined) && opts.catalog !== undefined) {
        await opts.catalog.upsert(id, {
          ...(name !== undefined ? { name } : {}),
          ...(description !== undefined ? { description } : {}),
        });
      }
      return jsonResponse({ ok: true, database: id });
    }

    if (req.method === "POST" && url.pathname === MEMORIES_HTTP_PATH.databasesMetadataGet) {
      const { body } = await readJsonBody(req);
      const id = parseDatabaseIdBody((body as Record<string, unknown>).database ?? body);
      await authorize(opts.auth, req, "read", id);
      const catalog = requireCatalog(opts);
      const meta = await catalog.get(id);
      return jsonResponse({
        name: meta?.name ?? "",
        description: meta?.description ?? "",
        database: id,
      });
    }

    if (req.method === "POST" && url.pathname === MEMORIES_HTTP_PATH.databasesMetadataUpsert) {
      const { body } = await readJsonBody(req);
      const record = body as Record<string, unknown>;
      const id = parseDatabaseIdBody(record.database ?? body);
      await authorize(opts.auth, req, "manage", id);
      const catalog = requireCatalog(opts);
      const name = typeof record.name === "string" ? record.name : undefined;
      const description = typeof record.description === "string" ? record.description : undefined;
      const meta = await catalog.upsert(id, {
        ...(name !== undefined ? { name } : {}),
        ...(description !== undefined ? { description } : {}),
      });
      return jsonResponse({ ...meta, database: id });
    }

    if (req.method === "POST" && url.pathname === MEMORIES_HTTP_PATH.databasesExists) {
      const { body } = await readJsonBody(req);
      const id = parseDatabaseIdBody(body);
      await authorize(opts.auth, req, "read", id);
      const exists = await opts.service.exists(id);
      return jsonResponse({ exists, database: id });
    }

    if (req.method === "POST" && url.pathname === MEMORIES_HTTP_PATH.databasesCheckpoint) {
      const { body } = await readJsonBody(req);
      const id = parseDatabaseIdBody(body);
      await authorize(opts.auth, req, "write", id);
      await opts.service.checkpoint(id);
      return jsonResponse({ ok: true, database: id });
    }

    if (req.method === "POST" && url.pathname === MEMORIES_HTTP_PATH.databasesClose) {
      const { body } = await readJsonBody(req);
      const id = parseDatabaseIdBody(body);
      await authorize(opts.auth, req, "manage", id);
      await opts.service.close(id);
      return jsonResponse({ ok: true, database: id });
    }

    if (req.method === "DELETE" && url.pathname === MEMORIES_HTTP_PATH.databases) {
      const { body } = await readJsonBody(req);
      const id = parseDatabaseIdBody(body);
      await authorize(opts.auth, req, "manage", id);
      await opts.service.delete(id);
      if (opts.catalog !== undefined) {
        await opts.catalog.remove(id);
      }
      return jsonResponse({ ok: true, database: id });
    }

    if (req.method === "POST" && url.pathname === MEMORIES_HTTP_PATH.databasesSearch) {
      const { body } = await readJsonBody(req);
      const id = parseDatabaseIdBody((body as Record<string, unknown>).database);
      await authorize(opts.auth, req, "read", id, scopeFromMemoryBody(body));
      return await handleDatabaseSearch(opts.service, body);
    }

    if (req.method === "POST" && url.pathname === MEMORIES_HTTP_PATH.databasesSearchNamespaces) {
      const { body } = await readJsonBody(req);
      const id = parseDatabaseIdBody((body as Record<string, unknown>).database);
      await authorize(opts.auth, req, "read", id, scopeFromMemoryBody(body));
      return await handleDatabaseSearchNamespaces(opts.service, body);
    }

    if (req.method === "POST" && url.pathname === MEMORIES_HTTP_PATH.databasesMerge) {
      const { body, bodySha256 } = await readJsonBody(req);
      const id = parseDatabaseIdBody((body as Record<string, unknown>).database);
      const actor = await authorize(opts.auth, req, "write", id, scopeFromMemoryBody(body));
      const attribution =
        opts.attribution !== undefined
          ? await buildRequestAttribution(opts.attribution, actor, req, bodySha256)
          : undefined;
      return await handleDatabaseMerge(
        opts.service,
        body,
        attribution,
        opts.ontology,
        opts.maxNamespaces,
        namespacePathPolicyFromHttpOpts(opts),
      );
    }

    if (req.method === "POST" && url.pathname === MEMORIES_HTTP_PATH.databasesDeleteMemory) {
      const { body, bodySha256 } = await readJsonBody(req);
      const id = parseDatabaseIdBody((body as Record<string, unknown>).database);
      const actor = await authorize(opts.auth, req, "write", id, scopeFromMemoryBody(body));
      const attribution =
        opts.attribution !== undefined
          ? await buildRequestAttribution(opts.attribution, actor, req, bodySha256)
          : undefined;
      return handleDatabaseDeleteMemory(opts.service, body, attribution);
    }

    if (req.method === "POST" && url.pathname === MEMORIES_HTTP_PATH.databasesSuppressMemory) {
      const { body, bodySha256 } = await readJsonBody(req);
      const id = parseDatabaseIdBody((body as Record<string, unknown>).database);
      const actor = await authorize(opts.auth, req, "write", id, scopeFromMemoryBody(body));
      const attribution =
        opts.attribution !== undefined
          ? await buildRequestAttribution(opts.attribution, actor, req, bodySha256)
          : undefined;
      return handleDatabaseSuppressMemory(opts.service, body, attribution);
    }

    if (req.method === "POST" && url.pathname === MEMORIES_HTTP_PATH.databasesUnsuppressMemory) {
      const { body, bodySha256 } = await readJsonBody(req);
      const id = parseDatabaseIdBody((body as Record<string, unknown>).database);
      const actor = await authorize(opts.auth, req, "write", id, scopeFromMemoryBody(body));
      const attribution =
        opts.attribution !== undefined
          ? await buildRequestAttribution(opts.attribution, actor, req, bodySha256)
          : undefined;
      return handleDatabaseUnsuppressMemory(opts.service, body, attribution);
    }

    if (req.method === "POST" && url.pathname === MEMORIES_HTTP_PATH.databasesSuppressNamespace) {
      const { body, bodySha256 } = await readJsonBody(req);
      const id = parseDatabaseIdBody((body as Record<string, unknown>).database);
      const actor = await authorize(opts.auth, req, "write", id, scopeFromMemoryBody(body));
      const attribution =
        opts.attribution !== undefined
          ? await buildRequestAttribution(opts.attribution, actor, req, bodySha256)
          : undefined;
      return handleDatabaseSuppressNamespace(opts.service, body, attribution);
    }

    if (req.method === "POST" && url.pathname === MEMORIES_HTTP_PATH.databasesUnsuppressNamespace) {
      const { body, bodySha256 } = await readJsonBody(req);
      const id = parseDatabaseIdBody((body as Record<string, unknown>).database);
      const actor = await authorize(opts.auth, req, "write", id, scopeFromMemoryBody(body));
      const attribution =
        opts.attribution !== undefined
          ? await buildRequestAttribution(opts.attribution, actor, req, bodySha256)
          : undefined;
      return handleDatabaseUnsuppressNamespace(opts.service, body, attribution);
    }

    if (req.method === "POST" && url.pathname === MEMORIES_HTTP_PATH.databasesProvenanceHead) {
      const { body } = await readJsonBody(req);
      const id = parseDatabaseIdBody((body as Record<string, unknown>).database);
      await authorize(opts.auth, req, "read", id, scopeFromMemoryBody(body));
      return await handleDatabaseProvenanceHead(opts.service, body);
    }

    if (req.method === "POST" && url.pathname === MEMORIES_HTTP_PATH.databasesProvenanceTimestamp) {
      const { body } = await readJsonBody(req);
      const id = parseDatabaseIdBody((body as Record<string, unknown>).database);
      await authorize(opts.auth, req, "read", id, scopeFromMemoryBody(body));
      return await handleDatabaseProvenanceTimestamp(opts.service, body);
    }

    if (req.method === "POST" && url.pathname === MEMORIES_HTTP_PATH.databasesProvenanceEvents) {
      const { body } = await readJsonBody(req);
      const id = parseDatabaseIdBody((body as Record<string, unknown>).database);
      await authorize(opts.auth, req, "read", id, scopeFromMemoryBody(body));
      return await handleDatabaseProvenanceEvents(opts.service, body);
    }

    if (req.method === "POST" && url.pathname === MEMORIES_HTTP_PATH.databasesProvenanceChain) {
      const { body } = await readJsonBody(req);
      const id = parseDatabaseIdBody((body as Record<string, unknown>).database);
      await authorize(opts.auth, req, "read", id, scopeFromMemoryBody(body));
      return await handleDatabaseProvenanceChain(opts.service, body);
    }

    if (req.method === "POST" && url.pathname === MEMORIES_HTTP_PATH.databasesProvenanceContent) {
      const { body } = await readJsonBody(req);
      const id = parseDatabaseIdBody((body as Record<string, unknown>).database);
      await authorize(opts.auth, req, "read", id, scopeFromMemoryBody(body));
      return await handleDatabaseProvenanceContent(opts.service, body);
    }

    if (req.method === "POST" && url.pathname === MEMORIES_HTTP_PATH.databasesProvenanceGraph) {
      const { body } = await readJsonBody(req);
      const id = parseDatabaseIdBody((body as Record<string, unknown>).database);
      await authorize(opts.auth, req, "read", id, scopeFromMemoryBody(body));
      return await handleDatabaseProvenanceGraph(opts.service, body);
    }

    if (req.method === "POST" && url.pathname === MEMORIES_HTTP_PATH.databasesProvenanceVectors) {
      const { body } = await readJsonBody(req);
      const id = parseDatabaseIdBody((body as Record<string, unknown>).database);
      await authorize(opts.auth, req, "read", id, scopeFromMemoryBody(body));
      return await handleDatabaseProvenanceVectors(opts.service, body);
    }

    if (req.method === "POST" && url.pathname === MEMORIES_HTTP_PATH.databasesMemoryDetail) {
      const { body } = await readJsonBody(req);
      const id = parseDatabaseIdBody((body as Record<string, unknown>).database);
      await authorize(opts.auth, req, "read", id, scopeFromMemoryBody(body));
      return await handleDatabaseMemoryDetail(opts.service, body);
    }

    if (req.method === "POST" && url.pathname === MEMORIES_HTTP_PATH.databasesEdgeDetail) {
      const { body } = await readJsonBody(req);
      const id = parseDatabaseIdBody((body as Record<string, unknown>).database);
      await authorize(opts.auth, req, "read", id, scopeFromMemoryBody(body));
      return await handleDatabaseEdgeDetail(opts.service, body);
    }

    if (req.method === "POST" && url.pathname === MEMORIES_HTTP_PATH.databasesCapabilities) {
      const { body } = await readJsonBody(req);
      const id = parseDatabaseIdBody((body as Record<string, unknown>).database);
      await authorize(opts.auth, req, "read", id, scopeDatabase());
      return handleDatabaseCapabilities(opts.service, body, namespacePathPolicyFromHttpOpts(opts));
    }

    if (req.method === "POST" && url.pathname === MEMORIES_HTTP_PATH.databasesNamespaces) {
      const { body } = await readJsonBody(req);
      const id = parseDatabaseIdBody((body as Record<string, unknown>).database);
      await authorize(opts.auth, req, "read", id, scopeDatabase());
      return handleDatabaseNamespaces(opts.service, body);
    }

    if (
      req.method === "POST" &&
      url.pathname === MEMORIES_HTTP_PATH.databasesNamespacesUnderPrefix
    ) {
      const { body } = await readJsonBody(req);
      const id = parseDatabaseIdBody((body as Record<string, unknown>).database);
      await authorize(opts.auth, req, "read", id, scopeFromPrefixBody(body));
      return await handleDatabaseNamespacesUnderPrefix(opts.service, body);
    }

    if (
      req.method === "POST" &&
      url.pathname === MEMORIES_HTTP_PATH.databasesNamespacesExistsUnderPrefix
    ) {
      const { body } = await readJsonBody(req);
      const id = parseDatabaseIdBody((body as Record<string, unknown>).database);
      await authorize(opts.auth, req, "read", id, scopeFromPrefixBody(body));
      return await handleDatabaseNamespaceExistsUnderPrefix(opts.service, body);
    }

    if (req.method === "POST" && url.pathname === MEMORIES_HTTP_PATH.databasesNamespacesGet) {
      const { body } = await readJsonBody(req);
      const id = parseDatabaseIdBody((body as Record<string, unknown>).database);
      await authorize(opts.auth, req, "read", id, scopeFromNamespaceMutation(body));
      return handleDatabaseNamespaceGet(opts.service, body);
    }

    if (req.method === "POST" && url.pathname === MEMORIES_HTTP_PATH.databasesNamespacesUpsert) {
      const { body } = await readJsonBody(req);
      const id = parseDatabaseIdBody((body as Record<string, unknown>).database);
      await authorize(opts.auth, req, "write", id, scopeFromNamespaceMutation(body));
      return await handleDatabaseNamespaceUpsert(
        opts.service,
        body,
        opts.maxNamespaces,
        namespacePathPolicyFromHttpOpts(opts),
      );
    }

    if (req.method === "POST" && url.pathname === MEMORIES_HTTP_PATH.databasesNamespacesDelete) {
      const { body } = await readJsonBody(req);
      const id = parseDatabaseIdBody((body as Record<string, unknown>).database);
      await authorize(opts.auth, req, "write", id, scopeFromNamespaceDelete(body));
      return await handleDatabaseNamespaceDelete(opts.service, body);
    }

    if (req.method === "POST" && url.pathname === MEMORIES_HTTP_PATH.databasesNamespacesRename) {
      const { body } = await readJsonBody(req);
      const id = parseDatabaseIdBody((body as Record<string, unknown>).database);
      await authorize(opts.auth, req, "write", id, scopeFromRename(body));
      return await handleDatabaseNamespaceRename(
        opts.service,
        body,
        opts.maxNamespaces,
        namespacePathPolicyFromHttpOpts(opts),
      );
    }

    if (req.method === "POST" && url.pathname === MEMORIES_HTTP_PATH.databasesEdgePreview) {
      const { body } = await readJsonBody(req);
      const id = parseDatabaseIdBody((body as Record<string, unknown>).database);
      await authorize(opts.auth, req, "read", id, scopeFromMemoryBody(body));
      return handleDatabaseEdgePreview(opts.service, body);
    }

    if (req.method === "POST" && url.pathname === MEMORIES_HTTP_PATH.databasesMemoryPreview) {
      const { body } = await readJsonBody(req);
      const id = parseDatabaseIdBody((body as Record<string, unknown>).database);
      await authorize(opts.auth, req, "read", id, scopeFromMemoryBody(body));
      return await handleDatabaseMemoryPreview(opts.service, body);
    }

    if (
      req.method === "POST" &&
      url.pathname === MEMORIES_HTTP_PATH.databasesSourceMapTextPreview
    ) {
      const { body } = await readJsonBody(req);
      const id = parseDatabaseIdBody((body as Record<string, unknown>).database);
      const actor = await opts.auth.authenticate(req);
      return await handleDatabaseSourceMapTextPreview(opts.service, body, async (namespace) => {
        await opts.auth.authorize({
          actor,
          action: "read",
          database: id,
          scope: { kind: "namespace", namespace, mode: "exact" },
        });
      });
    }

    if (req.method === "POST" && url.pathname === MEMORIES_HTTP_PATH.databasesSourceMapText) {
      const { body } = await readJsonBody(req);
      const id = parseDatabaseIdBody((body as Record<string, unknown>).database);
      const actor = await opts.auth.authenticate(req);
      return await handleDatabaseSourceMapText(opts.service, body, async (namespace) => {
        await opts.auth.authorize({
          actor,
          action: "read",
          database: id,
          scope: { kind: "namespace", namespace, mode: "exact" },
        });
      });
    }

    if (req.method === "POST" && url.pathname === MEMORIES_HTTP_PATH.databasesSourceMapReplace) {
      const { body, bodySha256 } = await readJsonBody(req);
      const id = parseDatabaseIdBody((body as Record<string, unknown>).database);
      const actor = await authorize(opts.auth, req, "write", id, scopeFromMemoryBody(body));
      const attribution =
        opts.attribution !== undefined
          ? await buildRequestAttribution(opts.attribution, actor, req, bodySha256)
          : undefined;
      return await handleDatabaseSourceMapReplace(
        opts.service,
        body,
        attribution,
        namespacePathPolicyFromHttpOpts(opts),
      );
    }

    if (req.method === "POST" && url.pathname === MEMORIES_HTTP_PATH.databasesVectorDimensions) {
      const { body } = await readJsonBody(req);
      const id = parseDatabaseIdBody((body as Record<string, unknown>).database);
      await authorize(opts.auth, req, "read", id, scopeDatabase());
      return handleDatabaseVectorDimensions(opts.service, body);
    }

    if (req.method === "POST" && url.pathname === MEMORIES_HTTP_PATH.databasesGraphLayout) {
      const { body } = await readJsonBody(req);
      const id = parseDatabaseIdBody((body as Record<string, unknown>).database);
      await authorize(opts.auth, req, "read", id, scopeFromMemoryBody(body));
      return await handleDatabaseGraphLayout(opts.service, opts.projectionSource, body);
    }

    if (req.method === "POST" && url.pathname === MEMORIES_HTTP_PATH.databasesGraphCounts) {
      const { body } = await readJsonBody(req);
      const id = parseDatabaseIdBody((body as Record<string, unknown>).database);
      await authorize(opts.auth, req, "read", id, scopeFromMemoryBody(body));
      return await handleDatabaseGraphCounts(opts.service, body);
    }

    if (req.method === "POST" && url.pathname === MEMORIES_HTTP_PATH.databasesGraphStats) {
      const { body } = await readJsonBody(req);
      const id = parseDatabaseIdBody((body as Record<string, unknown>).database);
      await authorize(opts.auth, req, "read", id, scopeFromMemoryBody(body));
      return await handleDatabaseGraphStats(opts.service, body);
    }

    if (req.method === "POST" && url.pathname === MEMORIES_HTTP_PATH.databasesProjectionInput) {
      const { body } = await readJsonBody(req);
      const id = parseDatabaseIdBody((body as Record<string, unknown>).database);
      await authorize(opts.auth, req, "read", id, scopeFromMemoryBody(body));
      return await handleDatabaseProjectionInput(opts.service, opts.projectionSource, body);
    }

    if (req.method === "POST" && url.pathname === MEMORIES_HTTP_PATH.databasesEnsureScopeChain) {
      const { body } = await readJsonBody(req);
      const id = parseDatabaseIdBody((body as Record<string, unknown>).database);
      await authorize(opts.auth, req, "write", id, scopeFromMemoryBody(body));
      return handleDatabaseEnsureScopeChain(opts.service, body);
    }

    if (req.method === "POST" && url.pathname === MEMORIES_HTTP_PATH.databasesFindMemoryId) {
      const { body } = await readJsonBody(req);
      const id = parseDatabaseIdBody((body as Record<string, unknown>).database);
      await authorize(opts.auth, req, "read", id, scopeFromMemoryBody(body));
      return handleDatabaseFindMemoryId(opts.service, body);
    }

    if (
      req.method === "POST" &&
      url.pathname === MEMORIES_HTTP_PATH.databasesEffectiveSuppression
    ) {
      const { body } = await readJsonBody(req);
      const id = parseDatabaseIdBody((body as Record<string, unknown>).database);
      const record = body as { key?: unknown };
      await authorize(
        opts.auth,
        req,
        "read",
        id,
        typeof record.key === "string"
          ? scopeFromMemoryBody(body)
          : scopeFromNamespaceMutation(body),
      );
      return await handleDatabaseEffectiveSuppression(opts.service, body);
    }

    if (
      req.method === "POST" &&
      url.pathname === MEMORIES_HTTP_PATH.databasesLoadMemoryNamespaceKey
    ) {
      const { body } = await readJsonBody(req);
      const id = parseDatabaseIdBody((body as Record<string, unknown>).database);
      await authorize(opts.auth, req, "read", id, scopeFromMemoryBody(body));
      return handleDatabaseLoadMemoryNamespaceKey(opts.service, body);
    }

    if (req.method === "POST" && url.pathname === MEMORIES_HTTP_PATH.ontologiesRegister) {
      await authorize(opts.auth, req, "manage");
      const { body } = await readJsonBody(req);
      return handleOntologyRegister(requireOntology(opts), body);
    }

    if (req.method === "POST" && url.pathname === MEMORIES_HTTP_PATH.ontologiesGet) {
      await authorize(opts.auth, req, "read");
      const { body } = await readJsonBody(req);
      return handleOntologyGet(requireOntology(opts), body);
    }

    if (req.method === "POST" && url.pathname === MEMORIES_HTTP_PATH.ontologiesDatabases) {
      await authorize(opts.auth, req, "manage");
      const { body } = await readJsonBody(req);
      return handleOntologyListDatabases(requireOntology(opts), body);
    }

    if (req.method === "POST" && url.pathname === MEMORIES_HTTP_PATH.databasesOntologyLink) {
      const { body } = await readJsonBody(req);
      const id = parseDatabaseIdBody((body as Record<string, unknown>).database);
      await authorize(opts.auth, req, "write", id, scopeDatabase());
      return handleDatabaseOntologyLink(requireOntology(opts), body);
    }

    if (req.method === "POST" && url.pathname === MEMORIES_HTTP_PATH.databasesOntologyCurrent) {
      const { body } = await readJsonBody(req);
      const id = parseDatabaseIdBody((body as Record<string, unknown>).database);
      await authorize(opts.auth, req, "read", id, scopeDatabase());
      return handleDatabaseOntologyCurrent(requireOntology(opts), body);
    }

    if (req.method === "POST" && url.pathname === MEMORIES_HTTP_PATH.databasesHash) {
      const { body } = await readJsonBody(req);
      const id = parseDatabaseIdBody((body as Record<string, unknown>).database);
      await authorize(opts.auth, req, "read", id, scopeDatabase());
      return handleDatabaseHash(requireOntology(opts), body);
    }

    if (req.method === "POST" && url.pathname === MEMORIES_HTTP_PATH.databasesOntologyHistory) {
      const { body } = await readJsonBody(req);
      const id = parseDatabaseIdBody((body as Record<string, unknown>).database);
      await authorize(opts.auth, req, "read", id, scopeDatabase());
      return handleDatabaseOntologyHistory(requireOntology(opts), body);
    }

    return jsonResponse({ error: "Not found" }, 404);
  } catch (error) {
    if (error instanceof HttpError) {
      return jsonResponse({ error: error.message }, error.status);
    }
    if (error instanceof AuthStrategyError) {
      return jsonResponse({ error: error.message }, error.status);
    }
    const message = error instanceof Error ? error.message : String(error);
    return jsonResponse({ error: message }, 400);
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

export type CreateMemoriesServiceHttpServerOptions = MemoriesServiceHttpOptions & {
  port?: number;
  hostname?: string;
};

export function createMemoriesServiceHttpServer(opts: CreateMemoriesServiceHttpServerOptions) {
  return Bun.serve({
    port: opts.port,
    hostname: opts.hostname,
    fetch(req) {
      return handleMemoriesServiceHttpRequest(req, opts);
    },
  });
}
