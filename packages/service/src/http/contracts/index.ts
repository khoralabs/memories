export {
  buildMemoriesServiceDiscovery,
  MEMORIES_SERVICE_PROTOCOL_VERSION,
  type MemoriesServiceDiscovery,
  zMemoriesServiceAuthScheme,
  zMemoriesServiceDiscovery,
} from "./discovery";
export {
  MEMORIES_ERROR_CODE,
  type MemoriesErrorCode,
  type MemoriesErrorEnvelope,
  memoriesErrorCodeForStatus,
  zMemoriesErrorCode,
  zMemoriesErrorEnvelope,
} from "./error-codes";
export { MEMORIES_HTTP_PATH, type MemoriesHttpPathKey } from "./routes";
export * from "./wire";
