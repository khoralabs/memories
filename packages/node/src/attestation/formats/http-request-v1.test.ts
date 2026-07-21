import { describe, expect, test } from "bun:test";
import { base64UrlDecode, base64UrlEncode } from "../attestation";
import {
  buildHttpRequestAttestation,
  decodeHttpRequestPayload,
  KHORA_HTTP_REQUEST_V1,
  verifyHttpRequestAttestation,
} from "./http-request-v1";

describe("http request attestation v1", () => {
  test("build/decode round trip", async () => {
    const attestation = await buildHttpRequestAttestation({
      principal: "none:server",
      method: "POST",
      path: "/databases/merge",
      bodySha256: "abc123",
      issuedAt: "2026-06-26T00:00:00.000Z",
      sign: ({ payloadBytes }) => payloadBytes,
    });

    expect(attestation.format).toBe(KHORA_HTTP_REQUEST_V1);
    const payload = decodeHttpRequestPayload(attestation);
    expect(payload).toEqual({
      v: 1,
      principal: "none:server",
      issuedAt: "2026-06-26T00:00:00.000Z",
      method: "POST",
      path: "/databases/merge",
      bodySha256: "abc123",
    });
  });

  test("build with optional fields round trips", async () => {
    const attestation = await buildHttpRequestAttestation({
      principal: "did:key:z-test",
      method: "POST",
      path: "/databases/delete-memory",
      bodySha256: "deadbeef",
      nonce: "n1",
      eventDigest: "evt1",
      issuedAt: "2026-06-26T00:00:00.000Z",
      alg: "test",
      keyId: "did:key:z-test#key",
      sign: ({ payloadBytes }) => payloadBytes,
    });

    const payload = decodeHttpRequestPayload(attestation);
    expect(payload.nonce).toBe("n1");
    expect(payload.eventDigest).toBe("evt1");
    expect(attestation.alg).toBe("test");
    expect(attestation.keyId).toBe("did:key:z-test#key");
  });

  test("verify succeeds with matching signer/verifier", async () => {
    const attestation = await buildHttpRequestAttestation({
      principal: "none:server",
      method: "POST",
      path: "/databases/merge",
      bodySha256: "abc123",
      issuedAt: "2026-06-26T00:00:00.000Z",
      sign: ({ payloadBytes }) => payloadBytes,
    });

    const result = await verifyHttpRequestAttestation(
      attestation,
      ({ payloadBytes, signature }) => base64UrlEncode(payloadBytes) === base64UrlEncode(signature),
    );
    expect(result).toEqual({
      format: KHORA_HTTP_REQUEST_V1,
      principal: "none:server",
      verified: true,
    });
  });

  test("verifier failure throws", async () => {
    const attestation = await buildHttpRequestAttestation({
      principal: "none:server",
      method: "POST",
      path: "/databases/merge",
      bodySha256: "abc123",
      issuedAt: "2026-06-26T00:00:00.000Z",
      sign: ({ payloadBytes }) => payloadBytes,
    });

    await expect(verifyHttpRequestAttestation(attestation, () => false)).rejects.toThrow(
      "verification failed",
    );
  });

  test("rejects wrong format on decode", () => {
    const payload = base64UrlEncode(
      new TextEncoder().encode(
        JSON.stringify({
          v: 1,
          principal: "none:server",
          issuedAt: "2026-06-26T00:00:00.000Z",
          method: "POST",
          path: "/databases/merge",
          bodySha256: "abc123",
        }),
      ),
    );
    expect(() =>
      decodeHttpRequestPayload({
        v: 1,
        format: "khora.direct-principal-v1",
        principal: "none:server",
        payload,
        signature: base64UrlEncode(base64UrlDecode(payload)),
      }),
    ).toThrow(KHORA_HTTP_REQUEST_V1);
  });
});
