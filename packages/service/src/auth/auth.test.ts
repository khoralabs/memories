import { describe, expect, test } from "bun:test";

import {
  AuthStrategyError,
  createAppPolicyAuthStrategy,
  createAuthStrategy,
  createAuthStrategyFromEnv,
  createNoneAuthStrategy,
  createServerAdminAuthStrategy,
  MEMORIES_SERVICE_AUTH_ENV,
  readAuthSchemeFromEnv,
} from "./index";

describe("none auth strategy", () => {
  test("allows all requests", async () => {
    const auth = createNoneAuthStrategy();
    const actor = await auth.authenticate(new Request("http://localhost/databases"));
    await auth.authorize({ actor, action: "manage" });
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
  test("delegates authenticate and authorize including namespace", async () => {
    const seen: Array<{ action: string; namespace?: string }> = [];
    const auth = createAppPolicyAuthStrategy({
      async authenticate() {
        return { scheme: "app-policy", subject: "user-1", claims: { org: "acme" } };
      },
      async authorize(input) {
        seen.push({ action: input.action, namespace: input.namespace });
      },
    });

    const actor = await auth.authenticate(new Request("http://localhost/databases/search"));
    expect(actor).toEqual({ scheme: "app-policy", subject: "user-1", claims: { org: "acme" } });

    await auth.authorize({
      actor,
      action: "read",
      database: { kind: "account", ownerKey: "o1" },
      namespace: "user/a",
    });
    expect(seen).toEqual([{ action: "read", namespace: "user/a" }]);
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
