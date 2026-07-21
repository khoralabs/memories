import { describe, expect, test } from "bun:test";

import { AuthStrategyError, createNoneAuthStrategy, createServerAdminAuthStrategy } from "./index";

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
