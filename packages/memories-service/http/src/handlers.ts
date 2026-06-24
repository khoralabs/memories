import type {
  DatabaseKind,
  MemoriesDatabaseId,
  MemoriesDatabaseService,
} from "@khoralabs/memories-service";
import {
  AuthStrategyError,
  type DatabaseAction,
  type MemoriesDatabaseAccessStrategy,
} from "@khoralabs/memories-service-auth";

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
};

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
