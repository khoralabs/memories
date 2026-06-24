import { createNoneAuthStrategy } from "./none";
import { createServerAdminAuthStrategy } from "./server-admin";
import {
  type CreateAuthStrategyFromEnvOptions,
  MEMORIES_SERVICE_ADMIN_TOKEN_ENV,
  type MemoriesDatabaseAccessStrategy,
  type MemoriesServiceAuthScheme,
  readAuthSchemeFromEnv,
} from "./types";

export function createAuthStrategyFromEnv(
  opts: CreateAuthStrategyFromEnvOptions = {},
  env: Record<string, string | undefined> = process.env,
): MemoriesDatabaseAccessStrategy {
  const scheme = opts.scheme ?? readAuthSchemeFromEnv(env);
  return createAuthStrategy({
    scheme,
    adminToken: opts.adminToken ?? env[MEMORIES_SERVICE_ADMIN_TOKEN_ENV],
  });
}

export function createAuthStrategy(input: {
  scheme: MemoriesServiceAuthScheme;
  adminToken?: string;
}): MemoriesDatabaseAccessStrategy {
  if (input.scheme === "none") return createNoneAuthStrategy();
  const token = input.adminToken?.trim();
  if (token === undefined || token.length === 0) {
    throw new Error(`${MEMORIES_SERVICE_ADMIN_TOKEN_ENV} is required for server-admin auth`);
  }
  return createServerAdminAuthStrategy({ adminToken: token });
}
