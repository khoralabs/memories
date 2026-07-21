import type { ContributorAttestation } from "../attestation";
import {
  base64UrlDecode,
  base64UrlEncode,
  canonicalPayloadBytes,
  decodeCanonicalPayload,
  validateContributorAttestation,
} from "../attestation";
import type { ContributorAttestationVerification } from "../registry";

export const KHORA_HTTP_REQUEST_V1 = "khora.http-request-v1" as const;

export type HttpRequestAttestationPayload = {
  v: 1;
  principal: string;
  issuedAt: string;
  method: string;
  path: string;
  bodySha256: string;
  nonce?: string;
  eventDigest?: string;
};

export type HttpRequestSignatureInput = {
  payload: HttpRequestAttestationPayload;
  payloadBytes: Uint8Array;
};

export type HttpRequestContributorSigner = (
  input: HttpRequestSignatureInput,
) => string | Uint8Array | Promise<string | Uint8Array>;

export type HttpRequestContributorVerifier = (
  input: HttpRequestSignatureInput & {
    signature: Uint8Array;
    attestation: ContributorAttestation;
  },
) => boolean | Promise<boolean>;

export type BuildHttpRequestAttestationInput = {
  principal: string;
  method: string;
  path: string;
  bodySha256: string;
  sign: HttpRequestContributorSigner;
  nonce?: string;
  issuedAt?: string;
  eventDigest?: string;
  alg?: string;
  keyId?: string;
};

function signatureToBase64Url(signature: string | Uint8Array): string {
  return typeof signature === "string" ? signature : base64UrlEncode(signature);
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, label);
}

export async function buildHttpRequestAttestation(
  input: BuildHttpRequestAttestationInput,
): Promise<ContributorAttestation> {
  const payload: HttpRequestAttestationPayload = {
    v: 1,
    principal: input.principal,
    issuedAt: input.issuedAt ?? new Date().toISOString(),
    method: input.method,
    path: input.path,
    bodySha256: input.bodySha256,
    ...(input.nonce !== undefined ? { nonce: input.nonce } : {}),
    ...(input.eventDigest !== undefined ? { eventDigest: input.eventDigest } : {}),
  };
  const payloadBytes = canonicalPayloadBytes(payload);
  const signature = await input.sign({ payload, payloadBytes });
  return validateContributorAttestation({
    v: 1,
    format: KHORA_HTTP_REQUEST_V1,
    principal: input.principal,
    payload: base64UrlEncode(payloadBytes),
    signature: signatureToBase64Url(signature),
    ...(input.alg !== undefined ? { alg: input.alg } : {}),
    ...(input.keyId !== undefined ? { keyId: input.keyId } : {}),
  });
}

export function decodeHttpRequestPayload(
  attestation: ContributorAttestation,
): HttpRequestAttestationPayload {
  const parsed = validateContributorAttestation(attestation);
  if (parsed.format !== KHORA_HTTP_REQUEST_V1) {
    throw new Error(`Expected ${KHORA_HTTP_REQUEST_V1} attestation`);
  }
  const payload = decodeCanonicalPayload<HttpRequestAttestationPayload>(parsed.payload);
  if (payload.v !== 1) throw new Error("HttpRequestAttestationPayload.v must be 1");
  if (payload.principal !== parsed.principal) {
    throw new Error("HttpRequestAttestationPayload.principal must match attestation.principal");
  }
  return {
    v: 1,
    principal: requiredString(payload.principal, "HttpRequestAttestationPayload.principal"),
    issuedAt: requiredString(payload.issuedAt, "HttpRequestAttestationPayload.issuedAt"),
    method: requiredString(payload.method, "HttpRequestAttestationPayload.method"),
    path: requiredString(payload.path, "HttpRequestAttestationPayload.path"),
    bodySha256: requiredString(payload.bodySha256, "HttpRequestAttestationPayload.bodySha256"),
    ...(payload.nonce !== undefined
      ? { nonce: optionalString(payload.nonce, "HttpRequestAttestationPayload.nonce") }
      : {}),
    ...(payload.eventDigest !== undefined
      ? {
          eventDigest: optionalString(
            payload.eventDigest,
            "HttpRequestAttestationPayload.eventDigest",
          ),
        }
      : {}),
  };
}

export async function verifyHttpRequestAttestation(
  attestation: ContributorAttestation,
  verifier: HttpRequestContributorVerifier,
): Promise<ContributorAttestationVerification> {
  const payload = decodeHttpRequestPayload(attestation);
  const payloadBytes = canonicalPayloadBytes(payload);
  const verified = await verifier({
    payload,
    payloadBytes,
    signature: base64UrlDecode(attestation.signature),
    attestation,
  });
  if (!verified) throw new Error("HTTP request attestation signature verification failed");
  return { format: KHORA_HTTP_REQUEST_V1, principal: attestation.principal, verified: true };
}
