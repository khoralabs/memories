/**
 * Node/server-only: {@link createServiceReactMemoriesClient} over memories-service HTTP.
 * Do not import this entry from browser UI bundles — use `@khoralabs/memories-react-graph`
 * for components/types and implement {@link ReactMemoriesClient} (or import this from a
 * server module / SSR-safe boundary).
 */
import {
  createRemoteMemoriesReadClient,
  type DatabaseSearchResponse,
  deserializeSearchHits,
  MemoriesServiceClient,
  type MemoriesServiceClientAuthProvider,
  type MemoriesServiceFetch,
  type RemoteMemoriesReadClient,
} from "@khoralabs/memories-service/client";

import type {
  EdgePreviewJson,
  NamespaceSearchHitResult,
  ReactMemoriesClient,
} from "./memories-client.js";
import type { MemoriesDatabaseId } from "./memories-database-id.js";

export type {
  EdgePreviewJson,
  GraphSearchResult,
  MemoriesDatabaseId,
  NamespaceSearchArms,
  NamespaceSearchClientResult,
  NamespaceSearchHitResult,
  ReactMemoriesClient,
} from "./memories-client.js";

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
    async listNamespaces(opts) {
      const namespaces = await reads.listNamespaces(
        opts?.includeSuppressed === true ? { includeSuppressed: true } : undefined,
      );
      const root = options.namespaceRoot?.trim();
      return root ? { namespaces, namespaceRoot: root } : { namespaces };
    },

    async getGraph(input) {
      const layout = await reads.getGraphLayout({
        namespace: input.namespace,
        ...(input.scope !== undefined ? { scope: input.scope } : {}),
        ...(input.includeSuppressed === true ? { includeSuppressed: true } : {}),
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
          suppressed: n.suppressed === true,
        })),
        edges: layout.edges.map((e) => ({
          edgeId: e.edgeId,
          fromKey: e.fromKey,
          toKey: e.toKey,
          labels: e.labels,
          ...(e.directed !== undefined ? { directed: e.directed } : {}),
          suppressed: e.suppressed === true,
        })),
      };
    },

    async getGraphCounts(input) {
      return reads.getGraphCounts({
        namespace: input.namespace,
        ...(input.scope !== undefined ? { scope: input.scope } : {}),
        ...(input.includeSuppressed === true ? { includeSuppressed: true } : {}),
      });
    },

    async getGraphStats(input) {
      return reads.getGraphStats({
        namespace: input.namespace,
        ...(input.scope !== undefined ? { scope: input.scope } : {}),
        ...(input.includeSuppressed === true ? { includeSuppressed: true } : {}),
      });
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
            arms: { lexical: 1, vector: 1 },
            ...(input.maxVectorDistance !== undefined
              ? { maxVectorDistance: input.maxVectorDistance }
              : {}),
            ...(input.includeSuppressed === true ? { includeSuppressed: true } : {}),
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
        ...(input.vector !== undefined ? { vector: input.vector } : {}),
        ...(input.includeSuppressed === true ? { includeSuppressed: true } : {}),
      });
      return {
        query: response.query,
        under: response.under,
        namespaces: response.namespaces,
      };
    },

    async getEdgePreview(input) {
      const preview = await reads.getEdgePreview(
        input.namespace,
        input.edgeId,
        input.includeSuppressed === true ? { includeSuppressed: true } : undefined,
      );
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
        suppressed: row.suppressed === true,
      };
    },

    async getNamespaceMetadata(input) {
      const row = await reads.getNamespaceMetadata(input.namespace);
      if (row === null) return null;
      return {
        namespace: row.namespace,
        alias: row.alias,
        description: row.description,
        suppressed: row.suppressed === true,
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
      const response = await service.postJson<{ memoryIds: string[] }>("/databases/merge", {
        database,
        params: input.params,
        ...(input.intentSnapshotId !== undefined
          ? { intentSnapshotId: input.intentSnapshotId }
          : {}),
      });
      return { memoryIds: response.memoryIds };
    },

    async replaceFeature(input) {
      return service.postJson<{ sourceMapId: string; rootHex: string }>(
        "/databases/source-map/replace",
        {
          database,
          namespace: input.namespace,
          key: input.key,
          sourceKey: input.sourceKey,
          ...(input.text !== undefined ? { text: input.text } : {}),
          ...(input.vector !== undefined ? { vector: input.vector } : {}),
          ...(input.intentSnapshotId !== undefined
            ? { intentSnapshotId: input.intentSnapshotId }
            : {}),
        },
      );
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

    async getSourceMapText(input) {
      return reads.getSourceMapText(input.sourceMapId);
    },

    async listProvenanceEvents(input) {
      const response = await service.postJson<{
        events: Array<{
          id: string;
          rootHex: string;
          parentRootHex: string;
          eventType: string;
          createdAt: number;
          event: Record<string, unknown>;
          intentSnapshotId?: string;
        }>;
      }>("/databases/provenance/events", {
        database,
        ...(input.namespace !== undefined ? { namespace: input.namespace } : {}),
        ...(input.key !== undefined ? { key: input.key } : {}),
        ...(input.limit !== undefined ? { limit: input.limit } : {}),
        ...(input.before !== undefined ? { before: input.before } : {}),
      });
      return response.events;
    },

    async listProvenanceChain(input) {
      const response = await service.postJson<{
        links: Array<{
          rootHex: string;
          parentRootHex: string;
          eventType: string;
          createdAt: number;
          id: string;
        }>;
      }>("/databases/provenance/chain", {
        database,
        ...(input.limit !== undefined ? { limit: input.limit } : {}),
        ...(input.beforeRootHex !== undefined ? { beforeRootHex: input.beforeRootHex } : {}),
      });
      return response.links;
    },

    async getMemoryContentAtRootHex(input) {
      const response = await service.postJson<{
        content: Array<{ sourceKey: string; text: string }>;
      }>("/databases/provenance/content", {
        database,
        rootHex: input.rootHex,
        namespace: input.namespace,
        key: input.key,
      });
      return response.content;
    },
  };

  return client;
}
