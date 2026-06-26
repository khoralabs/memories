import type { GraphProjectionSource } from "@khoralabs/memories-projections";
import type {
  DatabaseKind,
  MemoriesDatabaseHandle,
  MemoriesDatabaseId,
  MemoriesDatabaseOntologyStore,
  MemoriesDatabaseService,
} from "@khoralabs/memories-service";
import {
  AuthStrategyError,
  type DatabaseAction,
  type MemoriesDatabaseAccessStrategy,
} from "@khoralabs/memories-service-auth";
import {
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
  handleDatabaseEnsureScopeChain,
  handleDatabaseFindMemoryId,
  handleDatabaseLoadMemoryNamespaceKey,
  handleDatabaseMerge,
  handleDatabaseNamespaces,
  handleDatabaseProvenanceHead,
  handleDatabaseSearch,
  handleDatabaseSourceMapTextPreview,
  handleDatabaseUmapInput,
  handleDatabaseVectorDimensions,
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

export type MemoriesServiceHttpOptions = {
  service: MemoriesDatabaseService;
  auth: MemoriesDatabaseAccessStrategy;
  ontology?: MemoriesDatabaseOntologyStore;
  projectionSource?: (input: {
    database: MemoriesDatabaseId;
    handle: MemoriesDatabaseHandle;
  }) => GraphProjectionSource | Promise<GraphProjectionSource | undefined>;
};

function requireOntology(opts: MemoriesServiceHttpOptions): MemoriesDatabaseOntologyStore {
  if (opts.ontology === undefined) {
    throw new HttpError("Ontology registry is not configured", 501);
  }
  return opts.ontology;
}

async function readJsonBody(req: Request): Promise<unknown> {
  const text = await req.text();
  if (text.trim().length === 0) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HttpError("Invalid JSON body", 400);
  }
}

async function authorize(
  auth: MemoriesDatabaseAccessStrategy,
  req: Request,
  action: DatabaseAction,
  database?: MemoriesDatabaseId,
): Promise<void> {
  const actor = await auth.authenticate(req);
  await auth.authorize({ actor, action, database });
}

export async function handleMemoriesServiceHttpRequest(
  req: Request,
  opts: MemoriesServiceHttpOptions,
): Promise<Response> {
  const url = new URL(req.url);

  try {
    if (req.method === "GET" && url.pathname === "/databases") {
      await authorize(opts.auth, req, "manage");
      const kind = url.searchParams.get("kind") ?? undefined;
      const databases = await opts.service.list(kind ? { kind } : undefined);
      return jsonResponse({ databases });
    }

    if (req.method === "POST" && url.pathname === "/databases/open") {
      const id = parseDatabaseIdBody(await readJsonBody(req));
      await authorize(opts.auth, req, "read", id);
      await opts.service.open(id);
      return jsonResponse({ ok: true, database: id });
    }

    if (req.method === "POST" && url.pathname === "/databases/exists") {
      const id = parseDatabaseIdBody(await readJsonBody(req));
      await authorize(opts.auth, req, "read", id);
      const exists = await opts.service.exists(id);
      return jsonResponse({ exists, database: id });
    }

    if (req.method === "POST" && url.pathname === "/databases/checkpoint") {
      const id = parseDatabaseIdBody(await readJsonBody(req));
      await authorize(opts.auth, req, "write", id);
      await opts.service.checkpoint(id);
      return jsonResponse({ ok: true, database: id });
    }

    if (req.method === "POST" && url.pathname === "/databases/close") {
      const id = parseDatabaseIdBody(await readJsonBody(req));
      await authorize(opts.auth, req, "manage", id);
      await opts.service.close(id);
      return jsonResponse({ ok: true, database: id });
    }

    if (req.method === "DELETE" && url.pathname === "/databases") {
      const id = parseDatabaseIdBody(await readJsonBody(req));
      await authorize(opts.auth, req, "manage", id);
      await opts.service.delete(id);
      return jsonResponse({ ok: true, database: id });
    }

    if (req.method === "POST" && url.pathname === "/databases/search") {
      const body = await readJsonBody(req);
      const id = parseDatabaseIdBody((body as Record<string, unknown>).database);
      await authorize(opts.auth, req, "read", id);
      return handleDatabaseSearch(opts.service, body);
    }

    if (req.method === "POST" && url.pathname === "/databases/merge") {
      const body = await readJsonBody(req);
      const id = parseDatabaseIdBody((body as Record<string, unknown>).database);
      await authorize(opts.auth, req, "write", id);
      return handleDatabaseMerge(opts.service, body);
    }

    if (req.method === "POST" && url.pathname === "/databases/delete-memory") {
      const body = await readJsonBody(req);
      const id = parseDatabaseIdBody((body as Record<string, unknown>).database);
      await authorize(opts.auth, req, "write", id);
      return handleDatabaseDeleteMemory(opts.service, body);
    }

    if (req.method === "POST" && url.pathname === "/databases/provenance/head") {
      const body = await readJsonBody(req);
      const id = parseDatabaseIdBody((body as Record<string, unknown>).database);
      await authorize(opts.auth, req, "read", id);
      return handleDatabaseProvenanceHead(opts.service, body);
    }

    if (req.method === "POST" && url.pathname === "/databases/capabilities") {
      const body = await readJsonBody(req);
      const id = parseDatabaseIdBody((body as Record<string, unknown>).database);
      await authorize(opts.auth, req, "read", id);
      return handleDatabaseCapabilities(opts.service, body);
    }

    if (req.method === "POST" && url.pathname === "/databases/namespaces") {
      const body = await readJsonBody(req);
      const id = parseDatabaseIdBody((body as Record<string, unknown>).database);
      await authorize(opts.auth, req, "read", id);
      return handleDatabaseNamespaces(opts.service, body);
    }

    if (req.method === "POST" && url.pathname === "/databases/edge-preview") {
      const body = await readJsonBody(req);
      const id = parseDatabaseIdBody((body as Record<string, unknown>).database);
      await authorize(opts.auth, req, "read", id);
      return handleDatabaseEdgePreview(opts.service, body);
    }

    if (req.method === "POST" && url.pathname === "/databases/source-map/text-preview") {
      const body = await readJsonBody(req);
      const id = parseDatabaseIdBody((body as Record<string, unknown>).database);
      await authorize(opts.auth, req, "read", id);
      return handleDatabaseSourceMapTextPreview(opts.service, body);
    }

    if (req.method === "POST" && url.pathname === "/databases/vector-dimensions") {
      const body = await readJsonBody(req);
      const id = parseDatabaseIdBody((body as Record<string, unknown>).database);
      await authorize(opts.auth, req, "read", id);
      return handleDatabaseVectorDimensions(opts.service, body);
    }

    if (req.method === "POST" && url.pathname === "/databases/projections/umap-input") {
      const body = await readJsonBody(req);
      const id = parseDatabaseIdBody((body as Record<string, unknown>).database);
      await authorize(opts.auth, req, "read", id);
      return await handleDatabaseUmapInput(opts.service, opts.projectionSource, body);
    }

    if (req.method === "POST" && url.pathname === "/databases/ensure-scope-chain") {
      const body = await readJsonBody(req);
      const id = parseDatabaseIdBody((body as Record<string, unknown>).database);
      await authorize(opts.auth, req, "write", id);
      return handleDatabaseEnsureScopeChain(opts.service, body);
    }

    if (req.method === "POST" && url.pathname === "/databases/find-memory-id") {
      const body = await readJsonBody(req);
      const id = parseDatabaseIdBody((body as Record<string, unknown>).database);
      await authorize(opts.auth, req, "read", id);
      return handleDatabaseFindMemoryId(opts.service, body);
    }

    if (req.method === "POST" && url.pathname === "/databases/load-memory-namespace-key") {
      const body = await readJsonBody(req);
      const id = parseDatabaseIdBody((body as Record<string, unknown>).database);
      await authorize(opts.auth, req, "read", id);
      return handleDatabaseLoadMemoryNamespaceKey(opts.service, body);
    }

    if (req.method === "POST" && url.pathname === "/ontologies/register") {
      await authorize(opts.auth, req, "manage");
      const body = await readJsonBody(req);
      return handleOntologyRegister(requireOntology(opts), body);
    }

    if (req.method === "POST" && url.pathname === "/ontologies/get") {
      await authorize(opts.auth, req, "read");
      const body = await readJsonBody(req);
      return handleOntologyGet(requireOntology(opts), body);
    }

    if (req.method === "POST" && url.pathname === "/ontologies/databases") {
      await authorize(opts.auth, req, "manage");
      const body = await readJsonBody(req);
      return handleOntologyListDatabases(requireOntology(opts), body);
    }

    if (req.method === "POST" && url.pathname === "/databases/ontology/link") {
      const body = await readJsonBody(req);
      const id = parseDatabaseIdBody((body as Record<string, unknown>).database);
      await authorize(opts.auth, req, "write", id);
      return handleDatabaseOntologyLink(requireOntology(opts), body);
    }

    if (req.method === "POST" && url.pathname === "/databases/ontology/current") {
      const body = await readJsonBody(req);
      const id = parseDatabaseIdBody((body as Record<string, unknown>).database);
      await authorize(opts.auth, req, "read", id);
      return handleDatabaseOntologyCurrent(requireOntology(opts), body);
    }

    if (req.method === "POST" && url.pathname === "/databases/ontology/history") {
      const body = await readJsonBody(req);
      const id = parseDatabaseIdBody((body as Record<string, unknown>).database);
      await authorize(opts.auth, req, "read", id);
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
