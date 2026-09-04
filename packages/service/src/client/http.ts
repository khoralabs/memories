/**
 * Lean HTTP client surface for browsers / Next client components.
 * Does not re-export ontology or remote (memories-node) clients.
 */
export {
  MEMORIES_SERVICE_PROTOCOL_VERSION,
  type MemoriesServiceDiscovery,
  zMemoriesServiceDiscovery,
} from "../http/contracts/discovery";
export {
  MEMORIES_ERROR_CODE,
  type MemoriesErrorCode,
  type MemoriesErrorEnvelope,
  memoriesErrorCodeForStatus,
  zMemoriesErrorCode,
  zMemoriesErrorEnvelope,
} from "../http/contracts/error-codes";
export { MEMORIES_HTTP_PATH, type MemoriesHttpPathKey } from "../http/contracts/routes";
export type {
  MemoriesDatabaseId,
  StoredOntologyJsonSchema,
  StoredOntologyJsonSchemaMetadata,
} from "../storage/core/index";
export {
  createBearerTokenAuthProvider,
  createNoAuthProvider,
  type MemoriesDatabaseListEntry,
  MemoriesServiceClient,
  type MemoriesServiceClientAuthProvider,
  MemoriesServiceClientError,
  type MemoriesServiceClientOptions,
  type MemoriesServiceFetch,
} from "./client";
