import type {
  DeleteMemoryParams,
  MemoriesClientOptions,
  SearchHit,
  SearchOutput,
  SearchParams,
  SuppressMemoryParams,
  SuppressNamespaceParams,
} from "@khoralabs/memories-node";
import { MemoriesClientAsync } from "@khoralabs/memories-node";
import type { LabelSchemaMap, OntologyDefinition } from "@khoralabs/memories-node/ontology";
import type {
  MemoriesBackendCapabilities,
  MemoriesPersistenceAsync,
} from "@khoralabs/memories-node/persistence";
import {
  decodeProjectionInput,
  type NamespaceProjectionInput,
  PROJECTION_INPUT_ENCODING_HEADER,
  type ProjectionInputCompression,
} from "@khoralabs/memories-node/projections/projection-input";
import type { MemoriesDatabaseId } from "../storage/core/index";

import { MemoriesServiceClient, type MemoriesServiceClientOptions } from "./client";
import {
  type DatabaseCapabilitiesResponse,
  type DatabaseDeleteMemoryRequest,
  type DatabaseMergeRequest,
  type DatabaseNamespaceMetadata,
  type DatabaseNamespacesResponse,
  type DatabaseProjectionInputRequest,
  type DatabaseProvenanceHeadResponse,
  type DatabaseProvenanceTimestampResponse,
  type DatabaseSearchRequest,
  type DatabaseSearchResponse,
  type DatabaseSuppressMemoryRequest,
  type DatabaseSuppressNamespaceRequest,
  type DatabaseUnsuppressMemoryRequest,
  type DatabaseUnsuppressNamespaceRequest,
  deserializeSearchHits,
  type SearchHitWire,
} from "./wire";

export type RemoteMemoriesClientAsyncOptions = MemoriesServiceClientOptions & {
  database: MemoriesDatabaseId;
  ontology: OntologyDefinition<LabelSchemaMap, LabelSchemaMap>;
} & Pick<MemoriesClientOptions, "store" | "storeForNamespace">;

function createRemotePersistence(
  client: MemoriesServiceClient,
  reads: RemoteMemoriesReadClient,
  database: MemoriesDatabaseId,
  capabilities: MemoriesBackendCapabilities,
): MemoriesPersistenceAsync {
  return {
    capabilities,
    withTransaction: async <T>(fn: () => Promise<T>) => fn(),
    getProvenanceHeadRootHex: async () => {
      const response = await client.postJson<DatabaseProvenanceHeadResponse>(
        "/databases/provenance/head",
        { database },
      );
      return response.rootHex.length > 0 ? response.rootHex : undefined;
    },
    getProvenanceTimestampMsForRootHex: async (rootHex: string) => {
      const response = await client.postJson<DatabaseProvenanceTimestampResponse>(
        "/databases/provenance/timestamp",
        { database, rootHex },
      );
      return response.timestampMs ?? undefined;
    },
    findMemoryIdByKey: async (namespace: string, key: string) =>
      reads.findMemoryIdByKey(namespace, key),
    loadMemoryNamespaceKey: async (memoryId: string) => reads.loadMemoryNamespaceKey(memoryId),
    /**
     * Remote path list is the catalog union (same rows as {@link listNamespacesWithMetadata}),
     * not the local memory-only distinct set.
     */
    listMemoryNamespaces: async () => {
      const namespaces = await reads.listNamespaces();
      return namespaces.map((entry) => entry.namespace);
    },
    listNamespacesWithMetadata: async () => reads.listNamespaces(),
    getNamespaceMetadata: async (namespace: string) => {
      const row = await reads.getNamespaceMetadata(namespace);
      return row ?? undefined;
    },
    getSourceMapTextPreview: async (sourceMapId: string, maxChars?: number) =>
      reads.getSourceMapTextPreview(sourceMapId, maxChars),
  } as unknown as MemoriesPersistenceAsync;
}

export class RemoteMemoriesClientAsync extends MemoriesClientAsync<LabelSchemaMap, LabelSchemaMap> {
  readonly #client: MemoriesServiceClient;
  readonly #database: MemoriesDatabaseId;

  constructor(opts: RemoteMemoriesClientAsyncOptions, capabilities: MemoriesBackendCapabilities) {
    const serviceClient = new MemoriesServiceClient(opts);
    const reads = new RemoteMemoriesReadClient(opts);
    super(
      createRemotePersistence(serviceClient, reads, opts.database, capabilities),
      opts.ontology,
      {
        store: opts.store,
        storeForNamespace: opts.storeForNamespace,
      },
    );
    this.#client = serviceClient;
    this.#database = opts.database;
  }

  override async search(params: SearchParams): Promise<SearchOutput> {
    const body: DatabaseSearchRequest = { database: this.#database, params };
    const response = await this.#client.postJson<DatabaseSearchResponse>("/databases/search", body);
    return {
      hits: deserializeSearchHits(response.hits) as unknown as SearchHit[],
      ...(response.vectorSearchMethod !== undefined
        ? { vectorSearchMethod: response.vectorSearchMethod }
        : {}),
    };
  }

  override async mergeMemory(
    params: Parameters<MemoriesClientAsync<LabelSchemaMap, LabelSchemaMap>["mergeMemory"]>[0],
  ): Promise<string[]> {
    const { attribution, ...safeParams } = params as typeof params & {
      attribution?: { intentSnapshotId?: string };
    };
    const body: DatabaseMergeRequest = {
      database: this.#database,
      params: safeParams as unknown as Record<string, unknown>,
      ...(attribution?.intentSnapshotId !== undefined
        ? { intentSnapshotId: attribution.intentSnapshotId }
        : {}),
    };
    const response = await this.#client.postJson<{ memoryIds: string[] }>("/databases/merge", body);
    return response.memoryIds;
  }

  override async deleteMemory(params: DeleteMemoryParams): Promise<void> {
    const { attribution, ...safeParams } = params as DeleteMemoryParams & {
      attribution?: { intentSnapshotId?: string };
    };
    const body: DatabaseDeleteMemoryRequest = {
      database: this.#database,
      namespace: safeParams.namespace,
      key: safeParams.key,
      ...(attribution?.intentSnapshotId !== undefined
        ? { intentSnapshotId: attribution.intentSnapshotId }
        : {}),
    };
    await this.#client.postJson("/databases/delete-memory", body);
  }

  override async suppressMemory(params: SuppressMemoryParams): Promise<void> {
    const { attribution, ...safeParams } = params as SuppressMemoryParams & {
      attribution?: { intentSnapshotId?: string };
    };
    const body: DatabaseSuppressMemoryRequest = {
      database: this.#database,
      namespace: safeParams.namespace,
      key: safeParams.key,
      ...(attribution?.intentSnapshotId !== undefined
        ? { intentSnapshotId: attribution.intentSnapshotId }
        : {}),
    };
    await this.#client.postJson("/databases/suppress-memory", body);
  }

  override async unsuppressMemory(params: SuppressMemoryParams): Promise<void> {
    const { attribution, ...safeParams } = params as SuppressMemoryParams & {
      attribution?: { intentSnapshotId?: string };
    };
    const body: DatabaseUnsuppressMemoryRequest = {
      database: this.#database,
      namespace: safeParams.namespace,
      key: safeParams.key,
      ...(attribution?.intentSnapshotId !== undefined
        ? { intentSnapshotId: attribution.intentSnapshotId }
        : {}),
    };
    await this.#client.postJson("/databases/unsuppress-memory", body);
  }

  override async suppressNamespace(params: SuppressNamespaceParams): Promise<void> {
    const { attribution, ...safeParams } = params as SuppressNamespaceParams & {
      attribution?: { intentSnapshotId?: string };
    };
    const body: DatabaseSuppressNamespaceRequest = {
      database: this.#database,
      namespace: safeParams.namespace,
      ...(attribution?.intentSnapshotId !== undefined
        ? { intentSnapshotId: attribution.intentSnapshotId }
        : {}),
    };
    await this.#client.postJson("/databases/suppress-namespace", body);
  }

  override async unsuppressNamespace(params: SuppressNamespaceParams): Promise<void> {
    const { attribution, ...safeParams } = params as SuppressNamespaceParams & {
      attribution?: { intentSnapshotId?: string };
    };
    const body: DatabaseUnsuppressNamespaceRequest = {
      database: this.#database,
      namespace: safeParams.namespace,
      ...(attribution?.intentSnapshotId !== undefined
        ? { intentSnapshotId: attribution.intentSnapshotId }
        : {}),
    };
    await this.#client.postJson("/databases/unsuppress-namespace", body);
  }
}

export async function createRemoteMemoriesClientAsync(
  opts: RemoteMemoriesClientAsyncOptions,
): Promise<RemoteMemoriesClientAsync> {
  const serviceClient = new MemoriesServiceClient(opts);
  const { capabilities } = await serviceClient.postJson<DatabaseCapabilitiesResponse>(
    "/databases/capabilities",
    { database: opts.database },
  );
  return new RemoteMemoriesClientAsync(opts, capabilities as MemoriesBackendCapabilities);
}

const deferredRemoteReady = new WeakMap<
  RemoteMemoriesClientAsync,
  () => Promise<RemoteMemoriesClientAsync>
>();

/**
 * Materialize a deferred remote client (capabilities fetch) and return the underlying
 * concrete {@link RemoteMemoriesClientAsync}. Safe to call concurrently (single-flight).
 *
 * Pass-through for already-eager clients (no-op identity). Prefer this before sync reads
 * (`ontology`) or optional `persistence` method presence checks when using a deferred handle.
 */
export async function readyDeferredRemoteMemoriesClientAsync(
  client: RemoteMemoriesClientAsync,
): Promise<RemoteMemoriesClientAsync> {
  const getReady = deferredRemoteReady.get(client);
  if (getReady === undefined) return client;
  return getReady();
}

/**
 * Sync handle that lazily materializes {@link createRemoteMemoriesClientAsync} on first use
 * (capabilities fetch + construction). Forwards the full client and `persistence` surface.
 *
 * Concurrent first operations share one in-flight create. Sync reads of non-function
 * properties (e.g. `ontology`) throw until materialization completes — call
 * {@link readyDeferredRemoteMemoriesClientAsync} first when you need those.
 */
export function createDeferredRemoteMemoriesClientAsync(
  opts: RemoteMemoriesClientAsyncOptions,
): RemoteMemoriesClientAsync {
  let clientPromise: Promise<RemoteMemoriesClientAsync> | undefined;
  let resolved: RemoteMemoriesClientAsync | undefined;

  const getClient = (): Promise<RemoteMemoriesClientAsync> => {
    if (resolved !== undefined) return Promise.resolve(resolved);
    clientPromise ??= createRemoteMemoriesClientAsync(opts).then(
      (client) => {
        resolved = client;
        return client;
      },
      (err: unknown) => {
        clientPromise = undefined;
        throw err;
      },
    );
    return clientPromise;
  };

  const forwardPersistence = (): MemoriesPersistenceAsync =>
    new Proxy({} as MemoriesPersistenceAsync, {
      get(_target, prop) {
        if (prop === "then") return undefined;
        if (resolved !== undefined) {
          const value = Reflect.get(resolved.persistence, prop, resolved.persistence);
          if (typeof value === "function") {
            return (value as (...a: unknown[]) => unknown).bind(resolved.persistence);
          }
          return value;
        }
        return async (...args: unknown[]) => {
          const client = await getClient();
          const value = Reflect.get(client.persistence, prop, client.persistence);
          if (typeof value !== "function") return value;
          return (value as (...a: unknown[]) => unknown).apply(client.persistence, args);
        };
      },
    });

  const deferred = new Proxy({} as RemoteMemoriesClientAsync, {
    get(_target, prop) {
      if (prop === "then") return undefined;
      if (prop === "persistence") return forwardPersistence();

      if (resolved !== undefined) {
        const value = Reflect.get(resolved, prop, resolved);
        if (typeof value === "function") {
          return (value as (...a: unknown[]) => unknown).bind(resolved);
        }
        return value;
      }

      // Sync non-function fields cannot be forwarded until the client exists.
      if (prop === "ontology") {
        throw new Error(
          'createDeferredRemoteMemoriesClientAsync: "ontology" is unavailable until the ' +
            "first successful operation materializes the client; " +
            "await readyDeferredRemoteMemoriesClientAsync(client) first",
        );
      }

      return async (...args: unknown[]) => {
        const client = await getClient();
        const value = Reflect.get(client, prop, client);
        if (typeof value !== "function") {
          throw new Error(
            `createDeferredRemoteMemoriesClientAsync: "${String(prop)}" is not a method; ` +
              "read non-function properties only after the first successful operation",
          );
        }
        return (value as (...a: unknown[]) => unknown).apply(client, args);
      };
    },
  });

  deferredRemoteReady.set(deferred, getClient);
  return deferred;
}

export type RemoteMemoriesReadClientOptions = RemoteMemoriesClientAsyncOptions;

export class RemoteMemoriesReadClient {
  readonly #client: MemoriesServiceClient;
  readonly #database: MemoriesDatabaseId;

  constructor(opts: RemoteMemoriesReadClientOptions) {
    this.#client = new MemoriesServiceClient(opts);
    this.#database = opts.database;
  }

  /** Primary remote catalog list (alias/description); same rows as persistence `listNamespacesWithMetadata`. */
  async listNamespaces(): Promise<DatabaseNamespaceMetadata[]> {
    const response = await this.#client.postJson<DatabaseNamespacesResponse>(
      "/databases/namespaces",
      {
        database: this.#database,
      },
    );
    return response.namespaces;
  }

  async getNamespaceMetadata(namespace: string): Promise<DatabaseNamespaceMetadata | null> {
    const response = await this.#client.postJson<{
      namespace: DatabaseNamespaceMetadata | null;
    }>("/databases/namespaces/get", {
      database: this.#database,
      namespace,
    });
    return response.namespace;
  }

  async upsertNamespaceMetadata(input: {
    namespace: string;
    alias?: string | null;
    /** @deprecated Use `alias`. */
    displayName?: string | null;
    description?: string;
  }): Promise<DatabaseNamespaceMetadata> {
    const response = await this.#client.postJson<{ namespace: DatabaseNamespaceMetadata }>(
      "/databases/namespaces/upsert",
      {
        database: this.#database,
        ...input,
      },
    );
    return response.namespace;
  }

  async deleteNamespace(input: {
    namespace: string;
    recursive?: boolean;
  }): Promise<{ namespaces: string[]; deletedMemories: number }> {
    return this.#client.postJson("/databases/namespaces/delete", {
      database: this.#database,
      ...input,
    });
  }

  async renameNamespace(input: { from: string; to: string; recursive?: boolean }): Promise<{
    namespaces: Array<{ from: string; to: string }>;
    renamedMemories: number;
  }> {
    return this.#client.postJson("/databases/namespaces/rename", {
      database: this.#database,
      ...input,
    });
  }

  async getEdgePreview(namespace: string, edgeId: string): Promise<Record<string, unknown>> {
    return this.#client.postJson("/databases/edge-preview", {
      database: this.#database,
      namespace,
      edgeId,
    });
  }

  async getSourceMapTextPreview(sourceMapId: string, maxChars = 2400): Promise<string | null> {
    const response = await this.#client.postJson<{ text: string | null }>(
      "/databases/source-map/text-preview",
      { database: this.#database, sourceMapId, maxChars },
    );
    return response.text;
  }

  async listVectorDimensions(): Promise<number[]> {
    const response = await this.#client.postJson<{ dimensions: number[] }>(
      "/databases/vector-dimensions",
      { database: this.#database },
    );
    return response.dimensions;
  }

  async fetchProjectionInput(input: {
    namespace: string;
    scope?: "exact" | "subtree";
    compression?: ProjectionInputCompression;
    includeProvenanceHead?: boolean;
    includeSuppressed?: boolean;
    dangerousSkipValidation?: boolean;
  }): Promise<NamespaceProjectionInput> {
    const compression = input.compression ?? "gzip";
    const body: DatabaseProjectionInputRequest = {
      database: this.#database,
      namespace: input.namespace,
      ...(input.scope !== undefined ? { scope: input.scope } : {}),
      compression,
      ...(input.includeProvenanceHead !== undefined
        ? { includeProvenanceHead: input.includeProvenanceHead }
        : {}),
      ...(input.includeSuppressed === true ? { includeSuppressed: true } : {}),
    };
    const response = await this.#client.postBinaryResponse(
      "/databases/projections/projection-input",
      body,
    );
    const responseCompression =
      (response.headers.get(
        PROJECTION_INPUT_ENCODING_HEADER,
      ) as ProjectionInputCompression | null) ?? compression;
    return decodeProjectionInput(await response.arrayBuffer(), {
      compression: responseCompression,
      dangerousSkipValidation: input.dangerousSkipValidation,
    });
  }

  /** @deprecated Use fetchProjectionInput */
  fetchUmapInput(
    input: Parameters<RemoteMemoriesReadClient["fetchProjectionInput"]>[0],
  ): Promise<NamespaceProjectionInput> {
    return this.fetchProjectionInput(input);
  }

  async ensureScopeChain(scopePaths: readonly string[]): Promise<void> {
    await this.#client.postJson("/databases/ensure-scope-chain", {
      database: this.#database,
      scopePaths,
    });
  }

  async findMemoryIdByKey(namespace: string, key: string): Promise<string | undefined> {
    const response = await this.#client.postJson<{ memoryId: string | null }>(
      "/databases/find-memory-id",
      { database: this.#database, namespace, key },
    );
    return response.memoryId ?? undefined;
  }

  async loadMemoryNamespaceKey(
    memoryId: string,
  ): Promise<{ namespace: string; key: string } | undefined> {
    const response = await this.#client.postJson<{
      record: { namespace: string; key: string } | null;
    }>("/databases/load-memory-namespace-key", { database: this.#database, memoryId });
    return response.record ?? undefined;
  }
}

export function createRemoteMemoriesReadClient(
  opts: RemoteMemoriesReadClientOptions,
): RemoteMemoriesReadClient {
  return new RemoteMemoriesReadClient(opts);
}

export type { SearchHitWire };
