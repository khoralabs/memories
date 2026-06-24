import type { MemoriesDatabaseId } from "@khoralabs/memories-service";

export type DatabaseAction = "read" | "write" | "manage";

export type AuthenticatedActor = {
  scheme: string;
  subject: string;
  claims?: Record<string, unknown>;
};

export type MemoriesDatabaseAccessStrategy = {
  authenticate(req: Request): Promise<AuthenticatedActor>;
  authorize(input: {
    actor: AuthenticatedActor;
    action: DatabaseAction;
    database?: MemoriesDatabaseId;
    namespace?: string;
  }): Promise<void>;
};

export class AuthStrategyError extends Error {
  readonly status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.name = "AuthStrategyError";
    this.status = status;
  }
}

export type MemoriesServiceAuthScheme = "none" | "server-admin";

export const MEMORIES_SERVICE_AUTH_ENV = "MEMORIES_SERVICE_AUTH";
export const MEMORIES_SERVICE_ADMIN_TOKEN_ENV = "MEMORIES_SERVICE_ADMIN_TOKEN";

export type CreateAuthStrategyFromEnvOptions = {
  scheme?: MemoriesServiceAuthScheme;
  adminToken?: string;
};

export function readAuthSchemeFromEnv(
  env: Record<string, string | undefined> = process.env,
): MemoriesServiceAuthScheme {
  const raw = env[MEMORIES_SERVICE_AUTH_ENV]?.trim() ?? "none";
  if (raw === "none" || raw === "server-admin") return raw;
  throw new Error(`Unsupported ${MEMORIES_SERVICE_AUTH_ENV}: ${raw}`);
}
