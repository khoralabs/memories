import type { AuthenticatedActor, AuthorizeInput, MemoriesDatabaseAccessStrategy } from "./types";

export type AppPolicyAuthStrategyOptions = {
  authenticate(req: Request): Promise<AuthenticatedActor>;
  authorize(input: AuthorizeInput): Promise<void>;
};

/**
 * Host-wired access strategy. Identity, membership, and namespace rules stay in the host;
 * the service only receives opaque database ids, actions, and typed scopes.
 */
export function createAppPolicyAuthStrategy(
  opts: AppPolicyAuthStrategyOptions,
): MemoriesDatabaseAccessStrategy {
  if (typeof opts.authenticate !== "function") {
    throw new Error("createAppPolicyAuthStrategy requires authenticate");
  }
  if (typeof opts.authorize !== "function") {
    throw new Error("createAppPolicyAuthStrategy requires authorize");
  }
  return {
    authenticate: (req) => opts.authenticate(req),
    authorize: (input) => opts.authorize(input),
  };
}
