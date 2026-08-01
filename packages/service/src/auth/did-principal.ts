import type { MemoriesDatabaseId } from "../storage/core/index";
import { actionAllowed, authorizeScopeAgainstGrants, type HostGrant } from "./namespace-policy";
import {
  type AuthenticatedActor,
  type AuthorizeInput,
  AuthStrategyError,
  type MemoriesDatabaseAccessStrategy,
} from "./types";

/** Host-injected DID proof verify. Memories does not know wire format or DID methods. */
export type PrincipalProofVerifier = {
  verify(input: { method: string; request: Request }): Promise<{ did: string; keyId?: string }>;
};

export type CreateDidPrincipalAuthStrategyOptions = {
  verify: PrincipalProofVerifier;
  /** Optional; omit for direct-owner-only access. */
  resolveGrants?: (input: {
    actor: AuthenticatedActor;
    database: MemoriesDatabaseId;
  }) => Promise<HostGrant[]> | HostGrant[];
};

const OWNER_ACTIONS = ["manage"] as const;

/**
 * DID principal strategy: authenticate via injected proof verify; authorize when the
 * subject is `database.ownerKey` or (optionally) matches host grants.
 *
 * Not constructible from env alone — wire at server creation (same as `app-policy`).
 */
export function createDidPrincipalAuthStrategy(
  opts: CreateDidPrincipalAuthStrategyOptions,
): MemoriesDatabaseAccessStrategy {
  if (typeof opts.verify?.verify !== "function") {
    throw new Error("createDidPrincipalAuthStrategy requires verify.verify");
  }

  return {
    async authenticate(req: Request) {
      let proved: { did: string; keyId?: string };
      try {
        proved = await opts.verify.verify({ method: req.method, request: req });
      } catch (e) {
        if (e instanceof AuthStrategyError) throw e;
        throw new AuthStrategyError(e instanceof Error ? e.message : String(e), 401);
      }
      const did = proved.did.trim();
      if (did.length === 0) {
        throw new AuthStrategyError("principal proof returned empty did", 401);
      }
      return {
        scheme: "did-principal",
        subject: did,
        ...(proved.keyId !== undefined ? { claims: { keyId: proved.keyId } } : {}),
      };
    },

    async authorize(input: AuthorizeInput) {
      const { actor, action, database, scope } = input;
      if (database === undefined) {
        throw new AuthStrategyError("database required for did-principal authorize", 403);
      }

      if (actor.subject === database.ownerKey) {
        if (!actionAllowed([...OWNER_ACTIONS], action)) {
          throw new AuthStrategyError(`owner action ${action} not allowed`, 403);
        }
        return;
      }

      if (opts.resolveGrants === undefined) {
        throw new AuthStrategyError("principal is not the database owner", 403);
      }

      const grants = await opts.resolveGrants({ actor, database });
      authorizeScopeAgainstGrants(grants, { action, database, scope });
    },
  };
}
