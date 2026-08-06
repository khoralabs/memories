import {
  createRemoteMemoriesReadClient,
  type DatabaseSearchResponse,
  deserializeSearchHits,
  type MemoriesDatabaseId,
  MemoriesServiceClient,
  type MemoriesServiceClientAuthProvider,
  type MemoriesServiceFetch,
  type RemoteMemoriesReadClient,
} from "@khoralabs/memories-service/client";

import type { InvestigatorAnswer } from "./graph-investigator-types.js";
import type {
  MemoriesGraphNamespaceEntry,
  MemoriesGraphNamespacesPayload,
} from "./lib/namespace-entries.js";
import type { GraphPayload } from "./projection-types.js";

export type { InvestigatorAnswer, InvestigatorCitation } from "./graph-investigator-types.js";

export type EdgePreviewJson = {
  edgeId?: string;
  fromKey?: string;
  toKey?: string;
  labels?: Array<{ kind: string; props: Record<string, unknown> }>;
  properties?: Record<string, unknown> | null;
  error?: string;
};

/** Wire result from {@link ReactMemoriesClient.search} (before chrome maps to search state). */
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

/** Arm weights for {@link ReactMemoriesClient.searchNamespaces}. */
export type NamespaceSearchArms = {
  nodes?: number;
  lexical?: number;
  vector?: number;
};

/** Ranked namespace hit from {@link ReactMemoriesClient.searchNamespaces}. */
export type NamespaceSearchHitResult = {
  namespace: string;
  lineage: string[];
  score: number;
  hitCount: number;
  scoreSum: number;
  scoreMax: number;
  topHits: Array<{ memory_key: string; score: number; kind: "node" | "edge" }>;
};

/** Result from {@link ReactMemoriesClient.searchNamespaces}. */
export type NamespaceSearchClientResult = {
  query: string;
  under: string | null;
  namespaces: NamespaceSearchHitResult[];
};

/**
 * Host graph backend contract for React graph UI.
 *
 * Prefer {@link createServiceReactMemoriesClient} over `@khoralabs/memories-service`
 * (`POST /databases/*`). Custom hosts may implement this interface directly.
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

  /**
   * Rank namespaces via arms-driven search (`POST /databases/search-namespaces`).
   * @see NamespaceSearchArms
   */
  searchNamespaces(input: {
    query: string;
    namespace?: string;
    under?: string;
    limit?: number;
    nodeTopK?: number;
    arms?: NamespaceSearchArms;
    signal?: AbortSignal;
  }): Promise<NamespaceSearchClientResult>;

  getEdgePreview(input: {
    namespace: string;
    edgeId: string;
    signal?: AbortSignal;
  }): Promise<EdgePreviewJson>;

  upsertNamespace(input: {
    namespace: string;
    alias?: string | null;
    description?: string;
    signal?: AbortSignal;
  }): Promise<MemoriesGraphNamespaceEntry>;

  getNamespaceMetadata(input: {
    namespace: string;
    signal?: AbortSignal;
  }): Promise<MemoriesGraphNamespaceEntry | null>;

  renameNamespace(input: {
    from: string;
    to: string;
    recursive?: boolean;
    signal?: AbortSignal;
  }): Promise<{ namespaces: Array<{ from: string; to: string }>; renamedMemories: number }>;

  deleteNamespace(input: {
    namespace: string;
    recursive?: boolean;
    signal?: AbortSignal;
  }): Promise<{ namespaces: string[]; deletedMemories: number }>;

  suppressNamespace(input: {
    namespace: string;
    intentSnapshotId?: string;
    signal?: AbortSignal;
  }): Promise<void>;

  unsuppressNamespace(input: {
    namespace: string;
    intentSnapshotId?: string;
    signal?: AbortSignal;
  }): Promise<void>;

  mergeMemory(input: {
    params: Record<string, unknown>;
    intentSnapshotId?: string;
    signal?: AbortSignal;
  }): Promise<{ memoryIds: string[] }>;

  deleteMemory(input: { namespace: string; key: string; signal?: AbortSignal }): Promise<void>;

  getMemoryPreview(input: {
    namespace: string;
    key: string;
    maxChars?: number;
    signal?: AbortSignal;
  }): Promise<{
    key: string;
    namespace: string;
    labels: Array<{ kind: string; props: Record<string, unknown> }>;
    content: Array<{ sourceKey: string; text: string | null }>;
  }>;

  /** Sync investigate. Omit when the host has no investigate route. */
  investigate?(input: {
    namespace: string;
    question: string;
    signal?: AbortSignal;
  }): Promise<InvestigatorAnswer>;
};

const QUALIFIED_MEMORY_KEY_SEP = "::";
const SEARCH_HIT_SNIPPET_MAX = 2400;

function qualifySearchKey(
  namespace: string,
  memoryKey: string,
  scope: "exact" | "subtree",
): string {
  return scope === "subtree" ? `${namespace}${QUALIFIED_MEMORY_KEY_SEP}${memoryKey}` : memoryKey;
}

export type CreateServiceReactMemoriesClientOptions = {
  baseUrl: string;
  database: MemoriesDatabaseId;
  auth?: MemoriesServiceClientAuthProvider;
  fetch?: MemoriesServiceFetch;
  /**
   * Host catalog root stamped onto {@link ReactMemoriesClient.listNamespaces}.
   * Bare memories-service catalog has no root field — pass this (or provider prop).
   */
  namespaceRoot?: string;
  /** When set, exposed as {@link ReactMemoriesClient.investigate}. */
  investigate?: ReactMemoriesClient["investigate"];
  /** Test seam — defaults to {@link createRemoteMemoriesReadClient}. */
  reads?: RemoteMemoriesReadClient;
  /** Test seam — defaults to {@link MemoriesServiceClient}. */
  service?: MemoriesServiceClient;
};

/** {@link ReactMemoriesClient} over memories-service remote read + search HTTP. */
export function createServiceReactMemoriesClient(
  options: CreateServiceReactMemoriesClientOptions,
): ReactMemoriesClient {
  const reads =
    options.reads ??
    createRemoteMemoriesReadClient({
      baseUrl: options.baseUrl,
      database: options.database,
      ...(options.auth !== undefined ? { auth: options.auth } : {}),
      ...(options.fetch !== undefined ? { fetch: options.fetch } : {}),
    });
  const service =
    options.service ??
    new MemoriesServiceClient({
      baseUrl: options.baseUrl,
      ...(options.auth !== undefined ? { auth: options.auth } : {}),
      ...(options.fetch !== undefined ? { fetch: options.fetch } : {}),
    });
  const database = options.database;

  const client: ReactMemoriesClient = {
    async listNamespaces() {
      const namespaces = await reads.listNamespaces();
      const root = options.namespaceRoot?.trim();
      return root ? { namespaces, namespaceRoot: root } : { namespaces };
    },

    async getGraph(input) {
      const layout = await reads.getGraphLayout({
        namespace: input.namespace,
        ...(input.scope !== undefined ? { scope: input.scope } : {}),
      });
      return {
        namespace: layout.namespace,
        nodes: layout.nodes.map((n) => ({
          key: n.key,
          x: n.x,
          y: n.y,
          z: n.z,
          labels: n.labels,
          degree: n.degree,
        })),
        edges: layout.edges.map((e) => ({
          edgeId: e.edgeId,
          fromKey: e.fromKey,
          toKey: e.toKey,
          labels: e.labels,
          ...(e.directed !== undefined ? { directed: e.directed } : {}),
        })),
      };
    },

    async search(input) {
      const query = input.query.trim();
      const scope = input.scope === "exact" ? "exact" : "subtree";
      if (query.length === 0) {
        return {
          hitCount: 0,
          hitKeys: [],
          neighborKeys: [],
          keys: [],
          hitSnippets: [],
          edgeHitSnippets: [],
        };
      }

      const topK = Math.min(50, Math.max(1, input.topK ?? 10));
      const maxNeighbors = Math.min(50, Math.max(0, input.maxNeighbors ?? 5));
      const response = await service.postJson<DatabaseSearchResponse>("/databases/search", {
        database,
        params: {
          namespace: input.namespace,
          content: { text: query },
          searchScopeMode: scope === "exact" ? "exactScope" : "pathSubtree",
          options: {
            topK,
            maxNeighbors,
            neighbors: true,
            arms: { lexical: 1, vector: 0 },
            ...(input.maxVectorDistance !== undefined
              ? { maxVectorDistance: input.maxVectorDistance }
              : {}),
          },
        },
      });

      const hits = deserializeSearchHits(response.hits) as Array<{
        _id: string;
        source_key: string;
        memory: { namespace: string; key: string; kind: string };
        graph:
          | { kind: "node" }
          | {
              kind: "edge";
              edge: { edgeId: string; fromKey: string; toKey: string };
            };
        neighbors?: Array<{ namespace: string; key: string }>;
      }>;

      const hitKeys = hits.map((hit) =>
        qualifySearchKey(hit.memory.namespace, hit.memory.key, scope),
      );
      const neighborKeys: string[] = [];
      const edgeEndpointKeys: string[] = [];

      for (const hit of hits) {
        for (const neighbor of hit.neighbors ?? []) {
          neighborKeys.push(qualifySearchKey(neighbor.namespace, neighbor.key, scope));
        }
        if (hit.graph.kind === "edge") {
          edgeEndpointKeys.push(
            qualifySearchKey(hit.memory.namespace, hit.graph.edge.fromKey, scope),
            qualifySearchKey(hit.memory.namespace, hit.graph.edge.toKey, scope),
          );
        }
      }

      const keys = [...new Set([...hitKeys, ...neighborKeys, ...edgeEndpointKeys])];

      const hitSnippets = await Promise.all(
        hits.map(async (hit) => ({
          key: qualifySearchKey(hit.memory.namespace, hit.memory.key, scope),
          sourceKey: hit.source_key,
          text: await reads.getSourceMapTextPreview(hit._id, SEARCH_HIT_SNIPPET_MAX),
        })),
      );

      const edgeHitSnippets = (
        await Promise.all(
          hits.map(async (hit) => {
            if (hit.graph.kind !== "edge") return [];
            return [
              {
                edgeId: hit.memory.key,
                fromKey: qualifySearchKey(hit.memory.namespace, hit.graph.edge.fromKey, scope),
                toKey: qualifySearchKey(hit.memory.namespace, hit.graph.edge.toKey, scope),
                text: await reads.getSourceMapTextPreview(hit._id, SEARCH_HIT_SNIPPET_MAX),
              },
            ];
          }),
        )
      ).flat();

      return {
        hitCount: hits.length,
        hitKeys,
        neighborKeys: [...new Set(neighborKeys)],
        keys,
        hitSnippets,
        edgeHitSnippets,
      };
    },

    async searchNamespaces(input) {
      const query = input.query.trim();
      if (query.length === 0) {
        return { query: "", under: input.under?.trim() || null, namespaces: [] };
      }
      const response = await service.postJson<{
        query: string;
        under: string | null;
        namespaces: NamespaceSearchHitResult[];
      }>("/databases/search-namespaces", {
        database,
        query,
        ...(input.namespace !== undefined ? { namespace: input.namespace } : {}),
        ...(input.under !== undefined ? { under: input.under } : {}),
        ...(input.limit !== undefined ? { limit: input.limit } : {}),
        ...(input.nodeTopK !== undefined ? { nodeTopK: input.nodeTopK } : {}),
        ...(input.arms !== undefined ? { arms: input.arms } : {}),
      });
      return {
        query: response.query,
        under: response.under,
        namespaces: response.namespaces,
      };
    },

    async getEdgePreview(input) {
      const preview = await reads.getEdgePreview(input.namespace, input.edgeId);
      return preview as EdgePreviewJson;
    },

    async upsertNamespace(input) {
      const row = await reads.upsertNamespaceMetadata({
        namespace: input.namespace,
        ...(input.alias !== undefined ? { alias: input.alias } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
      });
      return {
        namespace: row.namespace,
        alias: row.alias,
        description: row.description,
        ...(row.suppressed === true ? { suppressed: true } : {}),
      };
    },

    async getNamespaceMetadata(input) {
      const row = await reads.getNamespaceMetadata(input.namespace);
      if (row === null) return null;
      return {
        namespace: row.namespace,
        alias: row.alias,
        description: row.description,
        ...(row.suppressed === true ? { suppressed: true } : {}),
      };
    },

    async renameNamespace(input) {
      return reads.renameNamespace({
        from: input.from,
        to: input.to,
        ...(input.recursive !== undefined ? { recursive: input.recursive } : {}),
      });
    },

    async deleteNamespace(input) {
      return reads.deleteNamespace({
        namespace: input.namespace,
        ...(input.recursive !== undefined ? { recursive: input.recursive } : {}),
      });
    },

    async suppressNamespace(input) {
      await service.postJson("/databases/suppress-namespace", {
        database,
        namespace: input.namespace,
        ...(input.intentSnapshotId !== undefined
          ? { intentSnapshotId: input.intentSnapshotId }
          : {}),
      });
    },

    async unsuppressNamespace(input) {
      await service.postJson("/databases/unsuppress-namespace", {
        database,
        namespace: input.namespace,
        ...(input.intentSnapshotId !== undefined
          ? { intentSnapshotId: input.intentSnapshotId }
          : {}),
      });
    },

    async mergeMemory(input) {
      return service.postJson<{ memoryIds: string[] }>("/databases/merge", {
        database,
        params: input.params,
        ...(input.intentSnapshotId !== undefined
          ? { intentSnapshotId: input.intentSnapshotId }
          : {}),
      });
    },

    async deleteMemory(input) {
      await service.postJson("/databases/delete-memory", {
        database,
        namespace: input.namespace,
        key: input.key,
      });
    },

    async getMemoryPreview(input) {
      return reads.getMemoryPreview({
        namespace: input.namespace,
        key: input.key,
        ...(input.maxChars !== undefined ? { maxChars: input.maxChars } : {}),
      });
    },

    ...(options.investigate !== undefined ? { investigate: options.investigate } : {}),
  };

  return client;
}
