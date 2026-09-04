import {
  type MemoriesErrorCode,
  memoriesErrorCodeForStatus,
  zMemoriesErrorCode,
} from "../http/contracts/error-codes";
import { MEMORIES_HTTP_PATH } from "../http/contracts/routes";
import type {
  DatabaseListFilter,
  MemoriesDatabaseId,
  MemoriesDatabaseMetadata,
} from "../storage/core/index";

export type MemoriesServiceClientAuthProvider = {
  applyAuth(req: RequestInit): RequestInit | Promise<RequestInit>;
};

export function createNoAuthProvider(): MemoriesServiceClientAuthProvider {
  return {
    applyAuth(req) {
      return req;
    },
  };
}

export function createBearerTokenAuthProvider(token: string): MemoriesServiceClientAuthProvider {
  const trimmed = token.trim();
  if (trimmed.length === 0) throw new Error("Bearer token is required");
  return {
    applyAuth(req) {
      const headers = new Headers(req.headers);
      headers.set("authorization", `Bearer ${trimmed}`);
      return { ...req, headers };
    },
  };
}

export type MemoriesServiceFetch = (
  url: string,
  init?: RequestInit,
) => Response | Promise<Response>;

export type MemoriesServiceClientOptions = {
  baseUrl: string;
  fetch?: MemoriesServiceFetch;
  auth?: MemoriesServiceClientAuthProvider;
};

export type MemoriesDatabaseListEntry = {
  id: MemoriesDatabaseId;
  name: string;
  description: string;
};

export class MemoriesServiceClientError extends Error {
  readonly status: number;
  readonly code?: MemoriesErrorCode;
  readonly bodyText?: string;

  constructor(message: string, status: number, bodyText?: string, code?: MemoriesErrorCode) {
    super(message);
    this.name = "MemoriesServiceClientError";
    this.status = status;
    this.bodyText = bodyText;
    if (code !== undefined) this.code = code;
  }
}

async function throwFromFailedResponse(response: Response): Promise<never> {
  const bodyText = await response.text().catch(() => undefined);
  let message = `Request failed with status ${response.status}`;
  let code: MemoriesErrorCode | undefined;
  if (bodyText !== undefined && bodyText.length > 0) {
    try {
      const parsed = JSON.parse(bodyText) as { error?: unknown; code?: unknown };
      if (typeof parsed.error === "string" && parsed.error.length > 0) {
        message = parsed.error;
      }
      const parsedCode = zMemoriesErrorCode.safeParse(parsed.code);
      if (parsedCode.success) code = parsedCode.data;
    } catch {
      // keep default message
    }
  }
  throw new MemoriesServiceClientError(
    message,
    response.status,
    bodyText,
    code ?? memoriesErrorCodeForStatus(response.status),
  );
}

export class MemoriesServiceClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: MemoriesServiceFetch;
  private readonly auth: MemoriesServiceClientAuthProvider;

  constructor(opts: MemoriesServiceClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.fetchImpl = opts.fetch ?? fetch;
    this.auth = opts.auth ?? createNoAuthProvider();
  }

  async listDatabases(filter?: DatabaseListFilter): Promise<MemoriesDatabaseListEntry[]> {
    const qs = filter?.kind ? `?kind=${encodeURIComponent(filter.kind)}` : "";
    const response = await this.request("GET", `${MEMORIES_HTTP_PATH.databases}${qs}`);
    const body = (await response.json()) as { databases?: MemoriesDatabaseListEntry[] };
    return body.databases ?? [];
  }

  async openDatabase(
    id: MemoriesDatabaseId,
    metadata?: { name?: string; description?: string },
  ): Promise<void> {
    await this.request("POST", MEMORIES_HTTP_PATH.databasesOpen, {
      ...id,
      ...(metadata?.name !== undefined ? { name: metadata.name } : {}),
      ...(metadata?.description !== undefined ? { description: metadata.description } : {}),
    });
  }

  async getDatabaseMetadata(id: MemoriesDatabaseId): Promise<MemoriesDatabaseMetadata> {
    const response = await this.requestJson("POST", MEMORIES_HTTP_PATH.databasesMetadataGet, {
      database: id,
    });
    const body = (await response.json()) as MemoriesDatabaseMetadata;
    return { name: body.name ?? "", description: body.description ?? "" };
  }

  async upsertDatabaseMetadata(
    id: MemoriesDatabaseId,
    patch: { name?: string; description?: string },
  ): Promise<MemoriesDatabaseMetadata> {
    const response = await this.requestJson("POST", MEMORIES_HTTP_PATH.databasesMetadataUpsert, {
      database: id,
      ...patch,
    });
    const body = (await response.json()) as MemoriesDatabaseMetadata;
    return { name: body.name ?? "", description: body.description ?? "" };
  }

  async databaseExists(id: MemoriesDatabaseId): Promise<boolean> {
    const response = await this.request("POST", MEMORIES_HTTP_PATH.databasesExists, id);
    const body = (await response.json()) as { exists?: boolean };
    return body.exists === true;
  }

  async checkpointDatabase(id: MemoriesDatabaseId): Promise<void> {
    await this.request("POST", MEMORIES_HTTP_PATH.databasesCheckpoint, id);
  }

  async closeDatabase(id: MemoriesDatabaseId): Promise<void> {
    await this.request("POST", MEMORIES_HTTP_PATH.databasesClose, id);
  }

  async deleteDatabase(id: MemoriesDatabaseId): Promise<void> {
    await this.request("DELETE", MEMORIES_HTTP_PATH.databases, id);
  }

  async postJson<T>(path: string, body: unknown, opts?: { signal?: AbortSignal }): Promise<T> {
    const response = await this.requestJson("POST", path, body, opts);
    return (await response.json()) as T;
  }

  async postBinaryResponse(
    path: string,
    body: unknown,
    opts?: { signal?: AbortSignal },
  ): Promise<Response> {
    return this.requestJson("POST", path, body, opts);
  }

  private async requestJson(
    method: string,
    path: string,
    body?: unknown,
    opts?: { signal?: AbortSignal },
  ): Promise<Response> {
    const init = await this.auth.applyAuth({
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      ...(opts?.signal !== undefined ? { signal: opts.signal } : {}),
    });
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, init);
    if (!response.ok) {
      await throwFromFailedResponse(response);
    }
    return response;
  }

  private async request(method: string, path: string, body?: unknown): Promise<Response> {
    const init = await this.auth.applyAuth({
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, init);
    if (!response.ok) {
      await throwFromFailedResponse(response);
    }
    return response;
  }
}
