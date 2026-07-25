import type { MemoriesDatabaseId } from "../storage/core/index";
import type { AuthenticatedActor, DatabaseAction, MemoriesDatabaseAccessStrategy } from "./types";

export type AppPolicyAuthStrategyOptions = {
  authenticate(req: Request): Promise<AuthenticatedActor>;
  authorize(input: {
    actor: AuthenticatedActor;
    action: DatabaseAction;
    database?: MemoriesDatabaseId;
    namespace?: string;
  }): Promise<void>;
};

/**
 * Host-wired access strategy. Identity, membership, and namespace rules stay in the host;
 * the service only receives opaque database ids and lifecycle actions.
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
