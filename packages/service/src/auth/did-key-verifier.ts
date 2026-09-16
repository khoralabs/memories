import {
  createMemoryNonceStore,
  type MemoriesNonceStore,
  verifyAgentRequest,
} from "./agent-request-wire";
import type { PrincipalProofVerifier } from "./did-principal";

export type CreateDidKeyPrincipalVerifierOptions = {
  nonceStore?: MemoriesNonceStore;
  now?: () => number;
  freshnessWindowMs?: number;
  signedQueryKeys?: readonly string[];
};

/**
 * PrincipalProofVerifier for did:key agents using X-Agent-* HTTP signatures.
 * Wire into `createDidPrincipalAuthStrategy({ verify: createDidKeyPrincipalVerifier() })`.
 */
export function createDidKeyPrincipalVerifier(
  opts: CreateDidKeyPrincipalVerifierOptions = {},
): PrincipalProofVerifier {
  const nonceStore = opts.nonceStore ?? createMemoryNonceStore();
  return {
    async verify(input) {
      const { did } = await verifyAgentRequest(input.request, {
        nonceStore,
        now: opts.now,
        freshnessWindowMs: opts.freshnessWindowMs,
        signedQueryKeys: opts.signedQueryKeys,
        ...(input.bodyText !== undefined ? { bodyText: input.bodyText } : {}),
      });
      return { did };
    },
  };
}
