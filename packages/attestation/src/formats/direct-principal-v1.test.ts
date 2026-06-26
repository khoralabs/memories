import { describe, expect, test } from "bun:test";
import { base64UrlDecode, base64UrlEncode } from "../attestation";
import {
  buildDirectPrincipalAttestation,
  decodeDirectPrincipalPayload,
  KHORA_DIRECT_PRINCIPAL_V1,
  verifyDirectPrincipalAttestation,
} from "./direct-principal-v1";

describe("direct principal attestation v1", () => {
  test("builds and verifies caller-signed direct principal attestations", async () => {
    const attestation = await buildDirectPrincipalAttestation({
      principal: "did:key:z-test",
      issuedAt: "2026-06-26T00:00:00.000Z",
      scope: { namespace: "ns", operation: "merge" },
      eventDigest: "abc123",
      alg: "test",
      keyId: "did:key:z-test#key",
      sign: ({ payloadBytes }) => payloadBytes,
    });

    expect(attestation.format).toBe(KHORA_DIRECT_PRINCIPAL_V1);
    expect(attestation.signature).toBe(attestation.payload);
    expect(decodeDirectPrincipalPayload(attestation)).toEqual({
      v: 1,
      principal: "did:key:z-test",
      issuedAt: "2026-06-26T00:00:00.000Z",
      scope: { namespace: "ns", operation: "merge" },
      eventDigest: "abc123",
    });

    await expect(
      verifyDirectPrincipalAttestation(attestation, ({ payloadBytes, signature }) => {
        return base64UrlEncode(payloadBytes) === base64UrlEncode(signature);
      }),
    ).resolves.toEqual({
      format: KHORA_DIRECT_PRINCIPAL_V1,
      principal: "did:key:z-test",
      verified: true,
    });
  });

  test("rejects payload principal mismatch", () => {
    const payload = base64UrlEncode(
      new TextEncoder().encode(
        JSON.stringify({
          v: 1,
          principal: "did:key:z-other",
          issuedAt: "2026-06-26T00:00:00.000Z",
          scope: { operation: "merge" },
        }),
      ),
    );

    expect(() =>
      decodeDirectPrincipalPayload({
        v: 1,
        format: KHORA_DIRECT_PRINCIPAL_V1,
        principal: "did:key:z-test",
        payload,
        signature: base64UrlEncode(base64UrlDecode(payload)),
      }),
    ).toThrow("principal");
  });

  test("rejects malformed direct principal payload shape", () => {
    const payload = base64UrlEncode(
      new TextEncoder().encode(
        JSON.stringify({
          v: 1,
          principal: "did:key:z-test",
        }),
      ),
    );

    expect(() =>
      decodeDirectPrincipalPayload({
        v: 1,
        format: KHORA_DIRECT_PRINCIPAL_V1,
        principal: "did:key:z-test",
        payload,
        signature: base64UrlEncode(base64UrlDecode(payload)),
      }),
    ).toThrow("issuedAt");
  });
});
