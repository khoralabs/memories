export {
  type AppPolicyAuthStrategyOptions,
  createAppPolicyAuthStrategy,
} from "./app-policy";
export { createAuthStrategy, createAuthStrategyFromEnv } from "./factory";
export {
  actionAllowed,
  authorizeScopeAgainstGrants,
  type HostGrant,
  namespaceCovered,
} from "./namespace-policy";
export { createNoneAuthStrategy } from "./none";
export { createServerAdminAuthStrategy, type ServerAdminAuthStrategyOptions } from "./server-admin";
export type {
  AuthenticatedActor,
  AuthorizeInput,
  AuthorizeScope,
  CreateAuthStrategyFromEnvOptions,
  DatabaseAction,
  MemoriesDatabaseAccessStrategy,
  MemoriesServiceAuthScheme,
} from "./types";
export {
  AuthStrategyError,
  MEMORIES_SERVICE_ADMIN_TOKEN_ENV,
  MEMORIES_SERVICE_AUTH_ENV,
  readAuthSchemeFromEnv,
} from "./types";
