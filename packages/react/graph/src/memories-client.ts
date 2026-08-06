import type { InvestigatorAnswer } from "./graph-investigator-types.js";
import type { MemoriesGraphNamespacesPayload } from "./lib/namespace-entries.js";
import type { GraphPayload } from "./projection-types.js";

export type EdgePreviewJson = {
  edgeId?: string;
  fromKey?: string;
  toKey?: string;
  labels?: Array<{ kind: string; props: Record<string, unknown> }>;
  properties?: Record<string, unknown> | null;
  error?: string;
};

/** Wire result from host `POST …/search` (before chrome maps to {@link GraphSearchState}). */
export type GraphSearchResult = {
  hitCount: number;
  hitKeys?: string[];
  neighborKeys?: string[];
  keys: string[];
  hitSnippets: Array<{ key: string; sourceKey?: string; text: string | null }>;
  edgeHitSnippets: Array<{
    edgeId: string;
    fromKey?: string;
    toKey?: string;
    text: string | null;
  }>;
};

/**
 * Host graph backend contract for React graph UI.
 *
 * Default HTTP shape (relative to `createHttpReactMemoriesClient` `baseUrl`):
 * - `GET /namespaces`
 * - `GET /graph?namespace=…[&scope=subtree]`
 * - `POST /search`
 * - `GET /edge-preview?namespace=…&edgeId=…`
 * - `POST /investigate` (optional)
 */
export type ReactMemoriesClient = {
  listNamespaces(opts?: { signal?: AbortSignal }): Promise<MemoriesGraphNamespacesPayload>;

  getGraph(input: {
    namespace: string;
    scope?: "exact" | "subtree";
    signal?: AbortSignal;
  }): Promise<GraphPayload>;

  search(input: {
    namespace: string;
    query: string;
    topK?: number;
    maxNeighbors?: number;
    maxVectorDistance?: number;
    scope?: "exact" | "subtree";
    signal?: AbortSignal;
  }): Promise<GraphSearchResult>;

  getEdgePreview(input: {
    namespace: string;
    edgeId: string;
    signal?: AbortSignal;
  }): Promise<EdgePreviewJson>;

  /** Sync investigate. Omit when the host has no investigate route. */
  investigate?(input: {
    namespace: string;
    question: string;
    signal?: AbortSignal;
  }): Promise<InvestigatorAnswer>;
};

export type CreateHttpReactMemoriesClientOptions = {
  /** Former `apiBase` — host memories REST prefix (trailing slash stripped). */
  baseUrl: string;
  credentials?: RequestCredentials;
  fetch?: typeof fetch;
};

function normalizeBaseUrl(base: string): string {
  const trimmed = base.trim() || "/api";
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

async function readJsonOrThrow<T extends { error?: string }>(res: Response): Promise<T> {
  const json = (await res.json()) as T;
  if (!res.ok) {
    throw new Error(json.error ?? res.statusText);
  }
  if (json.error) {
    throw new Error(json.error);
  }
  return json;
}

/** Default {@link ReactMemoriesClient} over the host `baseUrl` REST surface. */
export function createHttpReactMemoriesClient(
  options: CreateHttpReactMemoriesClientOptions,
): ReactMemoriesClient {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const credentials = options.credentials ?? "include";
  const fetchFn = options.fetch ?? fetch;

  const client: ReactMemoriesClient = {
    async listNamespaces(opts) {
      const res = await fetchFn(`${baseUrl}/namespaces`, {
        signal: opts?.signal,
        credentials,
      });
      return readJsonOrThrow<MemoriesGraphNamespacesPayload>(res);
    },

    async getGraph(input) {
      const scopeParam = input.scope === "subtree" ? "&scope=subtree" : "";
      const res = await fetchFn(
        `${baseUrl}/graph?namespace=${encodeURIComponent(input.namespace)}${scopeParam}`,
        { signal: input.signal, credentials },
      );
      const json = await readJsonOrThrow<GraphPayload & { error?: string }>(res);
      return {
        namespace: json.namespace,
        nodes: json.nodes ?? [],
        edges: json.edges ?? [],
      };
    },

    async search(input) {
      const res = await fetchFn(`${baseUrl}/search`, {
        method: "POST",
        signal: input.signal,
        credentials,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          namespace: input.namespace,
          query: input.query,
          topK: input.topK ?? 10,
          maxNeighbors: input.maxNeighbors ?? 5,
          ...(input.maxVectorDistance !== undefined
            ? { maxVectorDistance: input.maxVectorDistance }
            : {}),
          ...(input.scope === "subtree" ? { scope: "subtree" } : {}),
        }),
      });
      const json = await readJsonOrThrow<{
        hitCount?: number;
        hitKeys?: string[];
        neighborKeys?: string[];
        keys?: string[];
        hitSnippets?: Array<{ key?: string; sourceKey?: string; text?: string | null }>;
        edgeHitSnippets?: Array<{
          edgeId?: string;
          fromKey?: string;
          toKey?: string;
          text?: string | null;
        }>;
        error?: string;
      }>(res);

      const hitSnippets: GraphSearchResult["hitSnippets"] = [];
      for (const row of json.hitSnippets ?? []) {
        const key = row.key?.trim();
        if (!key) continue;
        hitSnippets.push({
          key,
          ...(row.sourceKey !== undefined ? { sourceKey: row.sourceKey } : {}),
          text: row.text ?? null,
        });
      }

      const edgeHitSnippets: GraphSearchResult["edgeHitSnippets"] = [];
      for (const row of json.edgeHitSnippets ?? []) {
        const edgeId = row.edgeId?.trim();
        if (!edgeId) continue;
        edgeHitSnippets.push({
          edgeId,
          ...(row.fromKey !== undefined ? { fromKey: row.fromKey } : {}),
          ...(row.toKey !== undefined ? { toKey: row.toKey } : {}),
          text: row.text ?? null,
        });
      }

      return {
        hitCount: json.hitCount ?? 0,
        ...(json.hitKeys !== undefined ? { hitKeys: json.hitKeys } : {}),
        ...(json.neighborKeys !== undefined ? { neighborKeys: json.neighborKeys } : {}),
        keys: json.keys ?? [],
        hitSnippets,
        edgeHitSnippets,
      };
    },

    async getEdgePreview(input) {
      const res = await fetchFn(
        `${baseUrl}/edge-preview?namespace=${encodeURIComponent(input.namespace)}&edgeId=${encodeURIComponent(input.edgeId)}`,
        { signal: input.signal, credentials },
      );
      return readJsonOrThrow<EdgePreviewJson>(res);
    },

    async investigate(input) {
      const res = await fetchFn(`${baseUrl}/investigate`, {
        method: "POST",
        signal: input.signal,
        credentials,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ namespace: input.namespace, question: input.question }),
      });
      const json = await readJsonOrThrow<InvestigatorAnswer & { error?: string }>(res);
      return {
        answer: json.answer,
        ...(json.citations !== undefined ? { citations: json.citations } : {}),
        ...(json.follow_up_queries !== undefined
          ? { follow_up_queries: json.follow_up_queries }
          : {}),
      };
    },
  };

  return client;
}
