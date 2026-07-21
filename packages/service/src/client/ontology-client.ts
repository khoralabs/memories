import type { LabelSchemaMap, OntologyDefinition } from "@khoralabs/memories-ontologies";
import type { MemoriesDatabaseId, StoredOntologyJsonSchema } from "../service/index";
import { hashStoredOntology, ontologyToStoredJsonSchema } from "../service/index";

import type { MemoriesServiceClient } from "./client";
import type { DatabaseHashRequest, DatabaseHashResponse } from "./wire";

export type StoredOntologyFromDefinitionMetadata = {
  $id?: string;
  title?: string;
  description?: string;
};

export function storedOntologyFromDefinition<
  TNode extends LabelSchemaMap,
  TEdge extends LabelSchemaMap,
>(
  ontology: OntologyDefinition<TNode, TEdge>,
  metadata?: StoredOntologyFromDefinitionMetadata,
): StoredOntologyJsonSchema {
  return ontologyToStoredJsonSchema(ontology, metadata);
}

export function hashOntologyDefinition<TNode extends LabelSchemaMap, TEdge extends LabelSchemaMap>(
  ontology: OntologyDefinition<TNode, TEdge>,
  metadata?: StoredOntologyFromDefinitionMetadata,
): string {
  return hashStoredOntology(storedOntologyFromDefinition(ontology, metadata));
}

export type MemoriesOntologyClientOptions = {
  serviceClient: MemoriesServiceClient;
};

export class MemoriesOntologyClient {
  readonly #client: MemoriesServiceClient;

  constructor(opts: MemoriesOntologyClientOptions) {
    this.#client = opts.serviceClient;
  }

  async registerOntology(schema: StoredOntologyJsonSchema): Promise<{ hash: string }> {
    return this.#client.postJson<{ hash: string }>("/ontologies/register", { schema });
  }

  async getOntology(hash: string): Promise<{ hash: string; schema: StoredOntologyJsonSchema }> {
    return this.#client.postJson<{ hash: string; schema: StoredOntologyJsonSchema }>(
      "/ontologies/get",
      { hash },
    );
  }

  async listDatabasesByOntologyHash(hash: string): Promise<MemoriesDatabaseId[]> {
    const response = await this.#client.postJson<{ databases: MemoriesDatabaseId[] }>(
      "/ontologies/databases",
      { hash },
    );
    return response.databases;
  }

  async listDatabasesByLabelKinds(filter?: {
    nodeKinds?: string[];
    edgeKinds?: string[];
  }): Promise<MemoriesDatabaseId[]> {
    const response = await this.#client.postJson<{ databases: MemoriesDatabaseId[] }>(
      "/ontologies/databases",
      filter ?? {},
    );
    return response.databases;
  }

  async linkDatabase(database: MemoriesDatabaseId, hash: string): Promise<void> {
    await this.#client.postJson("/databases/ontology/link", { database, hash });
  }

  async getCurrentLink(
    database: MemoriesDatabaseId,
  ): Promise<{ hash: string; linkedAtMs: number } | undefined> {
    const response = await this.#client.postJson<{
      link: { hash: string; linkedAtMs: number } | null;
    }>("/databases/ontology/current", { database });
    return response.link ?? undefined;
  }

  async getDatabaseHash(database: MemoriesDatabaseId): Promise<string | undefined> {
    const body: DatabaseHashRequest = { database };
    const response = await this.#client.postJson<DatabaseHashResponse>("/databases/hash", body);
    return response.hash ?? undefined;
  }

  async listLinkHistory(database: MemoriesDatabaseId) {
    const response = await this.#client.postJson<{
      history: Array<{ hash: string; linkedAtMs: number; linkId: number }>;
    }>("/databases/ontology/history", { database });
    return response.history;
  }
}

export type EnsureDatabaseOntologyLinkOptions = {
  serviceClient: MemoriesServiceClient;
  ontologyClient?: MemoriesOntologyClient;
  database: MemoriesDatabaseId;
  schema: StoredOntologyJsonSchema;
  onMismatch?: (details: {
    database: MemoriesDatabaseId;
    linkedHash: string;
    clientHash: string;
  }) => void;
};

export async function ensureDatabaseOntologyLink(
  opts: EnsureDatabaseOntologyLinkOptions,
): Promise<{ hash: string; linked: boolean }> {
  const ontologyClient =
    opts.ontologyClient ?? new MemoriesOntologyClient({ serviceClient: opts.serviceClient });
  const { hash } = await ontologyClient.registerOntology(opts.schema);
  await opts.serviceClient.openDatabase(opts.database);
  const current = await ontologyClient.getCurrentLink(opts.database);
  if (current?.hash === hash) {
    return { hash, linked: false };
  }
  if (current !== undefined && current.hash !== hash) {
    opts.onMismatch?.({
      database: opts.database,
      linkedHash: current.hash,
      clientHash: hash,
    });
  }
  await ontologyClient.linkDatabase(opts.database, hash);
  return { hash, linked: true };
}
