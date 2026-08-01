import { describe, expect, test } from "bun:test";

import {
  AuthStrategyError,
  createAuthStrategy,
  createDidPrincipalAuthStrategy,
  type PrincipalProofVerifier,
} from "./index";

const ownerDid = "did:key:zOwner";
const otherDid = "did:key:zOther";
const database = { kind: "account" as const, ownerKey: ownerDid };

function verifier(did: string): PrincipalProofVerifier {
  return {
    async verify() {
      return { did };
    },
  };
}

describe("createDidPrincipalAuthStrategy", () => {
  test("authenticate returns did-principal actor", async () => {
    const auth = createDidPrincipalAuthStrategy({ verify: verifier(ownerDid) });
    const actor = await auth.authenticate(new Request("http://localhost/databases/open"));
    expect(actor).toEqual({ scheme: "did-principal", subject: ownerDid });
  });

  test("authenticate wraps verify failures as 401", async () => {
    const auth = createDidPrincipalAuthStrategy({
      verify: {
        async verify() {
          throw new Error("bad sig");
        },
      },
    });
    try {
      await auth.authenticate(new Request("http://localhost/x"));
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AuthStrategyError);
      expect((e as AuthStrategyError).status).toBe(401);
      expect((e as AuthStrategyError).message).toBe("bad sig");
    }
  });

  test("owner may act on matching database", async () => {
    const auth = createDidPrincipalAuthStrategy({ verify: verifier(ownerDid) });
    const actor = await auth.authenticate(new Request("http://localhost/x"));
    await auth.authorize({
      actor,
      action: "write",
      database,
      scope: { kind: "namespace", namespace: "a", mode: "exact" },
    });
  });

  test("non-owner denied without grants", async () => {
    const auth = createDidPrincipalAuthStrategy({ verify: verifier(otherDid) });
    const actor = await auth.authenticate(new Request("http://localhost/x"));
    await expect(
      auth.authorize({
        actor,
        action: "read",
        database,
        scope: { kind: "database" },
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  test("authorize without database is 403", async () => {
    const auth = createDidPrincipalAuthStrategy({ verify: verifier(ownerDid) });
    const actor = await auth.authenticate(new Request("http://localhost/x"));
    await expect(
      auth.authorize({ actor, action: "manage", scope: { kind: "database" } }),
    ).rejects.toMatchObject({ status: 403 });
  });

  test("resolveGrants allows namespace-scoped delegate", async () => {
    const auth = createDidPrincipalAuthStrategy({
      verify: verifier(otherDid),
      resolveGrants: () => [
        {
          database,
          namespaces: ["team"],
          actions: ["read"],
        },
      ],
    });
    const actor = await auth.authenticate(new Request("http://localhost/x"));
    await auth.authorize({
      actor,
      action: "read",
      database,
      scope: { kind: "namespace", namespace: "team/x", mode: "exact" },
    });
    await expect(
      auth.authorize({
        actor,
        action: "read",
        database,
        scope: { kind: "namespace", namespace: "other", mode: "exact" },
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  test("createAuthStrategy rejects did-principal from env construction", () => {
    expect(() => createAuthStrategy({ scheme: "did-principal" })).toThrow(
      /createDidPrincipalAuthStrategy/,
    );
  });
});
