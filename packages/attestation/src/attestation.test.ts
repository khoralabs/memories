import { describe, expect, test } from "bun:test";
import {
  base64UrlEncode,
  canonicalPayloadBytes,
  decodeCanonicalPayload,
  validateContributorAttestation,
} from "./attestation";
import { verifyContributorAttestation } from "./registry";

describe("contributor attestation envelope", () => {
  test("validates explicit signed envelope fields", () => {
    const payload = base64UrlEncode(canonicalPayloadBytes({ v: 1, principal: "did:key:z-test" }));
    const attestation = validateContributorAttestation({
      v: 1,
      format: "khora.direct-principal-v1",
      principal: "did:key:z-test",
      payload,
      signature: "c2ln",
      alg: "EdDSA",
      keyId: "did:key:z-test#z-test",
    });

    expect(attestation.principal).toBe("did:key:z-test");
    expect(decodeCanonicalPayload<Record<string, unknown>>(attestation.payload)).toEqual({
      principal: "did:key:z-test",
      v: 1,
    });
  });

  test("canonical payload bytes are stable across key order", () => {
    expect(canonicalPayloadBytes({ b: 2, a: 1 })).toEqual(canonicalPayloadBytes({ a: 1, b: 2 }));
  });

  test("rejects invalid base64url fields", () => {
    expect(() =>
      validateContributorAttestation({
        v: 1,
        format: "khora.direct-principal-v1",
        principal: "did:key:z-test",
        payload: "not+url-safe",
        signature: "c2ln",
      }),
    ).toThrow("base64url");
  });

  test("rejects verifier results that do not match the parsed envelope", async () => {
    const payload = base64UrlEncode(canonicalPayloadBytes({ v: 1, principal: "did:key:z-test" }));

    await expect(
      verifyContributorAttestation(
        {
          v: 1,
          format: "khora.direct-principal-v1",
          principal: "did:key:z-test",
          payload,
          signature: "c2ln",
        },
        {
          "khora.direct-principal-v1": () => ({
            format: "khora.direct-principal-v1",
            principal: "did:key:z-other",
            verified: true,
          }),
        },
      ),
    ).rejects.toThrow("principal");
  });
});
