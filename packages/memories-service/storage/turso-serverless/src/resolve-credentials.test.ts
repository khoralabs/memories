import { describe, expect, test } from "bun:test";
import type { TursoServerlessBackendStrategy } from "@khoralabs/memories-service";

import { resolveTursoCredentials, resolveTursoDatabaseUrl } from "./resolve-credentials";

describe("resolveTursoCredentials", () => {
  const strategy: TursoServerlessBackendStrategy = {
    kind: "turso-serverless",
    url: "libsql://memories-{ownerKey}.example.turso.io",
    authToken: "test-token",
  };

  test("substitutes ownerKey in url template", () => {
    const id = { kind: "account", ownerKey: "alice" };
    expect(resolveTursoDatabaseUrl(strategy, id)).toBe("libsql://memories-alice.example.turso.io");
    expect(resolveTursoCredentials(strategy, id)).toEqual({
      url: "libsql://memories-alice.example.turso.io",
      authToken: "test-token",
      remoteEncryptionKey: undefined,
    });
  });

  test("substitutes kind and ownerKey placeholders", () => {
    const withKind: TursoServerlessBackendStrategy = {
      ...strategy,
      url: "libsql://{kind}-{ownerKey}.example.turso.io",
    };
    expect(resolveTursoDatabaseUrl(withKind, { kind: "account", ownerKey: "u1" })).toBe(
      "libsql://account-u1.example.turso.io",
    );
  });
});
