import { describe, expect, test } from "bun:test";

import {
  type AuthorizeScope,
  AuthStrategyError,
  actionAllowed,
  authorizeScopeAgainstGrants,
  createAppPolicyAuthStrategy,
  createAuthStrategy,
  createAuthStrategyFromEnv,
  createNoneAuthStrategy,
  createServerAdminAuthStrategy,
  type HostGrant,
  MEMORIES_SERVICE_AUTH_ENV,
  namespaceCovered,
  readAuthSchemeFromEnv,
} from "./index";

describe("none auth strategy", () => {
  test("allows all requests", async () => {
    const auth = createNoneAuthStrategy();
    const actor = await auth.authenticate(new Request("http://localhost/databases"));
    await auth.authorize({ actor, action: "manage", scope: { kind: "database" } });
  });
});

describe("server-admin auth strategy", () => {
  test("accepts configured bearer token", async () => {
    const auth = createServerAdminAuthStrategy({ adminToken: "secret-token" });
    const actor = await auth.authenticate(
      new Request("http://localhost/databases", {
        headers: { authorization: "Bearer secret-token" },
      }),
    );
    expect(actor.scheme).toBe("server-admin");
    await auth.authorize({ actor, action: "write", scope: { kind: "unscoped" } });
  });

  test("rejects missing or invalid bearer token", async () => {
    const auth = createServerAdminAuthStrategy({ adminToken: "secret-token" });
    await expect(
      auth.authenticate(new Request("http://localhost/databases")),
    ).rejects.toBeInstanceOf(AuthStrategyError);
    await expect(
      auth.authenticate(
        new Request("http://localhost/databases", {
          headers: { authorization: "Bearer wrong" },
        }),
      ),
    ).rejects.toBeInstanceOf(AuthStrategyError);
  });
});

describe("app-policy auth strategy", () => {
  test("delegates authenticate and authorize including scope", async () => {
    const seen: Array<{ action: string; namespace?: string; scope: AuthorizeScope }> = [];
    const auth = createAppPolicyAuthStrategy({
      async authenticate() {
        return { scheme: "app-policy", subject: "user-1", claims: { org: "acme" } };
      },
      async authorize(input) {
        seen.push({ action: input.action, namespace: input.namespace, scope: input.scope });
      },
    });

    const actor = await auth.authenticate(new Request("http://localhost/databases/search"));
    expect(actor).toEqual({ scheme: "app-policy", subject: "user-1", claims: { org: "acme" } });

    await auth.authorize({
      actor,
      action: "read",
      database: { kind: "account", ownerKey: "o1" },
      scope: { kind: "namespace", namespace: "user/a", mode: "exact" },
      namespace: "user/a",
    });
    expect(seen).toEqual([
      {
        action: "read",
        namespace: "user/a",
        scope: { kind: "namespace", namespace: "user/a", mode: "exact" },
      },
    ]);
  });

  test("requires authenticate and authorize hooks", () => {
    expect(() =>
      createAppPolicyAuthStrategy({
        authenticate: undefined as never,
        authorize: async () => undefined,
      }),
    ).toThrow(/authenticate/);
    expect(() =>
      createAppPolicyAuthStrategy({
        authenticate: async () => ({ scheme: "app-policy", subject: "x" }),
        authorize: undefined as never,
      }),
    ).toThrow(/authorize/);
  });
});

describe("auth scheme env", () => {
  test("readAuthSchemeFromEnv accepts app-policy", () => {
    expect(readAuthSchemeFromEnv({ [MEMORIES_SERVICE_AUTH_ENV]: "app-policy" })).toBe("app-policy");
  });

  test("createAuthStrategy rejects app-policy", () => {
    expect(() => createAuthStrategy({ scheme: "app-policy" })).toThrow(
      /createAppPolicyAuthStrategy/,
    );
  });

  test("createAuthStrategyFromEnv rejects app-policy", () => {
    expect(() =>
      createAuthStrategyFromEnv({}, { [MEMORIES_SERVICE_AUTH_ENV]: "app-policy" }),
    ).toThrow(/createAppPolicyAuthStrategy/);
  });
});

describe("namespace policy helpers", () => {
  test("actionAllowed respects manage ⊇ write ⊇ read", () => {
    expect(actionAllowed(["read"], "read")).toBe(true);
    expect(actionAllowed(["read"], "write")).toBe(false);
    expect(actionAllowed(["write"], "read")).toBe(true);
    expect(actionAllowed(["manage"], "write")).toBe(true);
  });

  test("namespaceCovered uses segment prefixes", () => {
    expect(namespaceCovered(["team"], "team")).toBe(true);
    expect(namespaceCovered(["team"], "team/a")).toBe(true);
    expect(namespaceCovered(["team"], "teams")).toBe(false);
    expect(namespaceCovered(["team/a"], "team")).toBe(false);
  });

  test("authorizeScopeAgainstGrants prefix allow and sibling deny", () => {
    const grants: HostGrant[] = [{ namespaces: ["team"], actions: ["read", "write"] }];
    authorizeScopeAgainstGrants(grants, {
      action: "read",
      scope: { kind: "namespace", namespace: "team/x", mode: "exact" },
    });
    expect(() =>
      authorizeScopeAgainstGrants(grants, {
        action: "read",
        scope: { kind: "namespace", namespace: "other", mode: "exact" },
      }),
    ).toThrow(AuthStrategyError);
  });

  test("unscoped denied without database-wide grant", () => {
    const grants: HostGrant[] = [{ namespaces: ["team"], actions: ["read"] }];
    expect(() =>
      authorizeScopeAgainstGrants(grants, { action: "read", scope: { kind: "unscoped" } }),
    ).toThrow(/database-wide/);
  });

  test("rename requires both from and to", () => {
    const grants: HostGrant[] = [{ namespaces: ["a"], actions: ["write"] }];
    expect(() =>
      authorizeScopeAgainstGrants(grants, {
        action: "write",
        scope: { kind: "namespaceRename", from: "a", to: "b", mode: "subtree" },
      }),
    ).toThrow(/destination/);
    authorizeScopeAgainstGrants([{ namespaces: ["a", "b"], actions: ["write"] }], {
      action: "write",
      scope: { kind: "namespaceRename", from: "a", to: "b", mode: "subtree" },
    });
  });

  test("namespaces requires every path", () => {
    const grants: HostGrant[] = [{ namespaces: ["a"], actions: ["read"] }];
    expect(() =>
      authorizeScopeAgainstGrants(grants, {
        action: "read",
        scope: { kind: "namespaces", namespaces: ["a", "b"], mode: "exact" },
      }),
    ).toThrow(/b/);
  });
});
