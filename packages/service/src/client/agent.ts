import {
  type LabelSchemaMap,
  mergeOntologies,
  type OntologyDefinition,
} from "@khoralabs/memories-node/ontology";
import type { MemoriesDatabaseId } from "../storage/core/index.ts";
import { createBearerTokenAuthProvider, type MemoriesServiceFetch } from "./client.ts";
import { minimalAgentMemoriesOntology } from "./minimal-agent-ontology.ts";
import {
  createDeferredRemoteMemoriesClientAsync,
  createRemoteMemoriesClientAsync,
  type RemoteMemoriesClientAsync,
} from "./remote-client.ts";

export type AgentMemoriesOntology = OntologyDefinition<LabelSchemaMap, LabelSchemaMap>;

export {
  AGENT_MEMORY_EDGE_KIND,
  AGENT_MEMORY_NODE_KIND,
  minimalAgentMemoriesOntology,
} from "./minimal-agent-ontology.ts";

/** Merge app ontology onto the agent Memory/References baseline (app wins on key collision). */
export function resolveAgentMemoriesOntology(
  appOntology: AgentMemoriesOntology,
): AgentMemoriesOntology {
  return mergeOntologies(minimalAgentMemoriesOntology, appOntology);
}

let installedFetch: MemoriesServiceFetch | undefined;

/** Host-provided signed fetch (RFC 9421). */
export function installMemoriesServiceFetch(fetchFn: MemoriesServiceFetch | undefined): void {
  installedFetch = fetchFn;
}

export function memoriesServiceFetch(): MemoriesServiceFetch {
  return installedFetch ?? fetch;
}

function remoteClientOptions(opts: {
  baseUrl: string;
  database: MemoriesDatabaseId;
  ontology: AgentMemoriesOntology;
  adminToken: string;
  fetch?: MemoriesServiceFetch;
}) {
  return {
    baseUrl: opts.baseUrl.replace(/\/$/, ""),
    database: opts.database,
    ontology: resolveAgentMemoriesOntology(opts.ontology),
    auth: createBearerTokenAuthProvider(opts.adminToken),
    fetch: opts.fetch ?? memoriesServiceFetch(),
  };
}

export async function createAgentMemoriesClient(opts: {
  baseUrl: string;
  database: MemoriesDatabaseId;
  ontology: AgentMemoriesOntology;
  adminToken: string;
  fetch?: MemoriesServiceFetch;
}): Promise<RemoteMemoriesClientAsync> {
  return createRemoteMemoriesClientAsync(remoteClientOptions(opts));
}

export function createDeferredAgentMemoriesClient(opts: {
  baseUrl: string;
  database: MemoriesDatabaseId;
  ontology: AgentMemoriesOntology;
  adminToken: string;
  fetch?: MemoriesServiceFetch;
}): RemoteMemoriesClientAsync {
  return createDeferredRemoteMemoriesClientAsync(remoteClientOptions(opts));
}

export function agentMemoriesDatabase(agentDid: string): MemoriesDatabaseId {
  return { kind: "account", ownerKey: agentDid };
}
