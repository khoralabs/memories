import type { DatabaseListFilter, MemoriesDatabaseId } from "@khoralabs/memories-service";

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

export class MemoriesServiceClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: MemoriesServiceFetch;
  private readonly auth: MemoriesServiceClientAuthProvider;

  constructor(opts: MemoriesServiceClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.fetchImpl = opts.fetch ?? fetch;
    this.auth = opts.auth ?? createNoAuthProvider();
  }

  async listDatabases(filter?: DatabaseListFilter): Promise<MemoriesDatabaseId[]> {
    const qs = filter?.kind ? `?kind=${encodeURIComponent(filter.kind)}` : "";
    const response = await this.request("GET", `/databases${qs}`);
    const body = (await response.json()) as { databases?: MemoriesDatabaseId[] };
    return body.databases ?? [];
  }

  async openDatabase(id: MemoriesDatabaseId): Promise<void> {
    await this.request("POST", "/databases/open", id);
  }

  async databaseExists(id: MemoriesDatabaseId): Promise<boolean> {
    const response = await this.request("POST", "/databases/exists", id);
    const body = (await response.json()) as { exists?: boolean };
    return body.exists === true;
  }

  async checkpointDatabase(id: MemoriesDatabaseId): Promise<void> {
    await this.request("POST", "/databases/checkpoint", id);
  }

  async closeDatabase(id: MemoriesDatabaseId): Promise<void> {
    await this.request("POST", "/databases/close", id);
  }

  async deleteDatabase(id: MemoriesDatabaseId): Promise<void> {
    await this.request("DELETE", "/databases", id);
  }

  async postJson<T>(path: string, body: unknown): Promise<T> {
    const response = await this.requestJson("POST", path, body);
    return (await response.json()) as T;
  }

  async postBinaryResponse(path: string, body: unknown): Promise<Response> {
    return this.requestJson("POST", path, body);
  }

  private async requestJson(method: string, path: string, body?: unknown): Promise<Response> {
    const init = await this.auth.applyAuth({
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, init);
    if (!response.ok) {
      const errorBody = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(errorBody.error ?? `Request failed with status ${response.status}`);
    }
    return response;
  }

  private async request(
    method: string,
    path: string,
    body?: MemoriesDatabaseId,
  ): Promise<Response> {
    const init = await this.auth.applyAuth({
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, init);
    if (!response.ok) {
      const errorBody = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(errorBody.error ?? `Request failed with status ${response.status}`);
    }
    return response;
  }
}
