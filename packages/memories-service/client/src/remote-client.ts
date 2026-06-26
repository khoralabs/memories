import type {
  DeleteMemoryParams,
  LabelSchemaMap,
  OntologyDefinition,
} from "@khoralabs/memories-core";
import { MemoriesClientAsync, type SearchHit, type SearchParams } from "@khoralabs/memories-core";
import type {
  MemoriesBackendCapabilities,
  MemoriesPersistenceAsync,
} from "@khoralabs/memories-persistence-core/persistence";
import {
  decodeUmapInput,
  type NamespaceUmapInput,
  UMAP_INPUT_ENCODING_HEADER,
  type UmapInputCompression,
} from "@khoralabs/memories-projections";
import type { MemoriesDatabaseId } from "@khoralabs/memories-service";

import { MemoriesServiceClient, type MemoriesServiceClientOptions } from "./client";
import {
  type DatabaseCapabilitiesResponse,
  type DatabaseDeleteMemoryRequest,
  type DatabaseMergeRequest,
  type DatabaseProvenanceHeadResponse,
  type DatabaseSearchRequest,
  type DatabaseSearchResponse,
  type DatabaseUmapInputRequest,
  deserializeSearchHits,
  type SearchHitWire,
} from "./wire";

export type RemoteMemoriesClientAsyncOptions = MemoriesServiceClientOptions & {
  database: MemoriesDatabaseId;
  ontology: OntologyDefinition<LabelSchemaMap, LabelSchemaMap>;
};

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
    findMemoryIdByKey: async (namespace: string, key: string) =>
      reads.findMemoryIdByKey(namespace, key),
    loadMemoryNamespaceKey: async (memoryId: string) => reads.loadMemoryNamespaceKey(memoryId),
    listMemoryNamespaces: async () => reads.listNamespaces(),
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
    );
    this.#client = serviceClient;
    this.#database = opts.database;
  }

  override async search(params: SearchParams): Promise<SearchHit[]> {
    const body: DatabaseSearchRequest = { database: this.#database, params };
    const response = await this.#client.postJson<DatabaseSearchResponse>("/databases/search", body);
    return deserializeSearchHits(response.hits) as unknown as SearchHit[];
  }

  override async mergeMemory(
    params: Parameters<MemoriesClientAsync<LabelSchemaMap, LabelSchemaMap>["mergeMemory"]>[0],
  ): Promise<string[]> {
    const body: DatabaseMergeRequest = {
      database: this.#database,
      params: params as unknown as Record<string, unknown>,
    };
    const response = await this.#client.postJson<{ memoryIds: string[] }>("/databases/merge", body);
    return response.memoryIds;
  }

  override async deleteMemory(params: DeleteMemoryParams): Promise<void> {
    const body: DatabaseDeleteMemoryRequest = {
      database: this.#database,
      namespace: params.namespace,
      key: params.key,
    };
    await this.#client.postJson("/databases/delete-memory", body);
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

export type RemoteMemoriesReadClientOptions = RemoteMemoriesClientAsyncOptions;

export class RemoteMemoriesReadClient {
  readonly #client: MemoriesServiceClient;
  readonly #database: MemoriesDatabaseId;

  constructor(opts: RemoteMemoriesReadClientOptions) {
    this.#client = new MemoriesServiceClient(opts);
    this.#database = opts.database;
  }

  async listNamespaces(): Promise<string[]> {
    const response = await this.#client.postJson<{ namespaces: string[] }>(
      "/databases/namespaces",
      {
        database: this.#database,
      },
    );
    return response.namespaces;
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

  async fetchUmapInput(input: {
    namespace: string;
    scope?: "exact" | "subtree";
    compression?: UmapInputCompression;
    includeProvenanceHead?: boolean;
    dangerousSkipValidation?: boolean;
  }): Promise<NamespaceUmapInput> {
    const compression = input.compression ?? "gzip";
    const body: DatabaseUmapInputRequest = {
      database: this.#database,
      namespace: input.namespace,
      ...(input.scope !== undefined ? { scope: input.scope } : {}),
      compression,
      ...(input.includeProvenanceHead !== undefined
        ? { includeProvenanceHead: input.includeProvenanceHead }
        : {}),
    };
    const response = await this.#client.postBinaryResponse(
      "/databases/projections/umap-input",
      body,
    );
    const responseCompression =
      (response.headers.get(UMAP_INPUT_ENCODING_HEADER) as UmapInputCompression | null) ??
      compression;
    return decodeUmapInput(await response.arrayBuffer(), {
      compression: responseCompression,
      dangerousSkipValidation: input.dangerousSkipValidation,
    });
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
