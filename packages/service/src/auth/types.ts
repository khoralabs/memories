import type { MemoriesDatabaseId } from "../storage/core/index";

export type DatabaseAction = "read" | "write" | "manage";

export type AuthenticatedActor = {
  scheme: string;
  subject: string;
  claims?: Record<string, unknown>;
};

/** Resource targeted by an HTTP authorize check. */
export type AuthorizeScope =
  | { kind: "database" }
  | { kind: "namespace"; namespace: string; mode: "exact" | "subtree" }
  | { kind: "namespaces"; namespaces: string[]; mode: "exact" | "subtree" }
  | { kind: "namespaceRename"; from: string; to: string; mode: "exact" | "subtree" }
  | { kind: "unscoped" };

export type AuthorizeInput = {
  actor: AuthenticatedActor;
  action: DatabaseAction;
  database?: MemoriesDatabaseId;
  scope: AuthorizeScope;
  /**
   * @deprecated Prefer `scope`. Mirrored when `scope.kind === "namespace"` for back-compat.
   */
  namespace?: string;
};

export type MemoriesDatabaseAccessStrategy = {
  authenticate(req: Request): Promise<AuthenticatedActor>;
  authorize(input: AuthorizeInput): Promise<void>;
};

export class AuthStrategyError extends Error {
  readonly status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.name = "AuthStrategyError";
    this.status = status;
  }
}

export type MemoriesServiceAuthScheme = "none" | "server-admin" | "app-policy" | "did-principal";

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
  if (raw === "none" || raw === "server-admin" || raw === "app-policy" || raw === "did-principal") {
    return raw;
  }
  throw new Error(`Unsupported ${MEMORIES_SERVICE_AUTH_ENV}: ${raw}`);
}
