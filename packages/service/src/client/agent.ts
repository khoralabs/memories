import type { Signer } from "@khoralabs/did-key-identity";
import {
  type LabelSchemaMap,
  mergeOntologies,
  type OntologyDefinition,
} from "@khoralabs/memories-node/ontology";
import type { MemoriesDatabaseId } from "../storage/core/index.ts";
import {
  createBearerTokenAuthProvider,
  createDidSignedRequestAuthProvider,
  type MemoriesServiceClientAuthProvider,
  type MemoriesServiceFetch,
} from "./client.ts";
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

/** Host-provided fetch override (e.g. signed transport). */
export function installMemoriesServiceFetch(fetchFn: MemoriesServiceFetch | undefined): void {
  installedFetch = fetchFn;
}

export function memoriesServiceFetch(): MemoriesServiceFetch {
  return installedFetch ?? fetch;
}

export type AgentMemoriesClientAuthOptions = {
  baseUrl: string;
  database: MemoriesDatabaseId;
  ontology: AgentMemoriesOntology;
  /** Shared-secret admin Bearer. Provide `adminToken` and/or `auth`/`signer`. */
  adminToken?: string;
  /** Explicit auth provider (wins over adminToken/signer). */
  auth?: MemoriesServiceClientAuthProvider;
  /** DID signer for X-Agent-* HTTP auth. */
  signer?: Signer;
  fetch?: MemoriesServiceFetch;
};

function resolveAgentAuth(opts: AgentMemoriesClientAuthOptions): MemoriesServiceClientAuthProvider {
  if (opts.auth !== undefined) return opts.auth;
  if (opts.signer !== undefined) return createDidSignedRequestAuthProvider(opts.signer);
  const token = opts.adminToken?.trim() ?? "";
  if (token.length > 0) return createBearerTokenAuthProvider(token);
  throw new Error("createAgentMemoriesClient requires adminToken, signer, or auth");
}

function remoteClientOptions(opts: AgentMemoriesClientAuthOptions) {
  return {
    baseUrl: opts.baseUrl.replace(/\/$/, ""),
    database: opts.database,
    ontology: resolveAgentMemoriesOntology(opts.ontology),
    auth: resolveAgentAuth(opts),
    fetch: opts.fetch ?? memoriesServiceFetch(),
  };
}

export async function createAgentMemoriesClient(
  opts: AgentMemoriesClientAuthOptions,
): Promise<RemoteMemoriesClientAsync> {
  return createRemoteMemoriesClientAsync(remoteClientOptions(opts));
}

export function createDeferredAgentMemoriesClient(
  opts: AgentMemoriesClientAuthOptions,
): RemoteMemoriesClientAsync {
  return createDeferredRemoteMemoriesClientAsync(remoteClientOptions(opts));
}

export function agentMemoriesDatabase(agentDid: string): MemoriesDatabaseId {
  return { kind: "account", ownerKey: agentDid };
}
