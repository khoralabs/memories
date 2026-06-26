import type { ContributorAttestation } from "../attestation";
import {
  base64UrlDecode,
  base64UrlEncode,
  canonicalPayloadBytes,
  decodeCanonicalPayload,
  validateContributorAttestation,
} from "../attestation";
import type { ContributorAttestationVerification } from "../registry";

export const KHORA_DIRECT_PRINCIPAL_V1 = "khora.direct-principal-v1" as const;

export type DirectPrincipalOperation = "merge" | "delete" | (string & {});

export type DirectPrincipalScope = {
  databaseId?: unknown;
  namespace?: string;
  operation: DirectPrincipalOperation;
};

export type DirectPrincipalAttestationPayload = {
  v: 1;
  principal: string;
  issuedAt: string;
  scope: DirectPrincipalScope;
  eventDigest?: string;
};

export type DirectPrincipalSignatureInput = {
  payload: DirectPrincipalAttestationPayload;
  payloadBytes: Uint8Array;
};

export type DirectPrincipalSigner = (
  input: DirectPrincipalSignatureInput,
) => string | Uint8Array | Promise<string | Uint8Array>;

export type DirectPrincipalVerifier = (
  input: DirectPrincipalSignatureInput & {
    signature: Uint8Array;
    attestation: ContributorAttestation;
  },
) => boolean | Promise<boolean>;

export type BuildDirectPrincipalAttestationInput = {
  principal: string;
  scope: DirectPrincipalScope;
  sign: DirectPrincipalSigner;
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

function decodeDirectPrincipalScope(value: unknown): DirectPrincipalScope {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("DirectPrincipalAttestationPayload.scope must be an object");
  }
  const record = value as Record<string, unknown>;
  return {
    ...(record.databaseId !== undefined ? { databaseId: record.databaseId } : {}),
    ...(record.namespace !== undefined
      ? {
          namespace: optionalString(
            record.namespace,
            "DirectPrincipalAttestationPayload.scope.namespace",
          ),
        }
      : {}),
    operation: requiredString(
      record.operation,
      "DirectPrincipalAttestationPayload.scope.operation",
    ),
  };
}

export async function buildDirectPrincipalAttestation(
  input: BuildDirectPrincipalAttestationInput,
): Promise<ContributorAttestation> {
  const payload: DirectPrincipalAttestationPayload = {
    v: 1,
    principal: input.principal,
    issuedAt: input.issuedAt ?? new Date().toISOString(),
    scope: input.scope,
    ...(input.eventDigest !== undefined ? { eventDigest: input.eventDigest } : {}),
  };
  const payloadBytes = canonicalPayloadBytes(payload);
  const signature = await input.sign({ payload, payloadBytes });
  return validateContributorAttestation({
    v: 1,
    format: KHORA_DIRECT_PRINCIPAL_V1,
    principal: input.principal,
    payload: base64UrlEncode(payloadBytes),
    signature: signatureToBase64Url(signature),
    ...(input.alg !== undefined ? { alg: input.alg } : {}),
    ...(input.keyId !== undefined ? { keyId: input.keyId } : {}),
  });
}

export function decodeDirectPrincipalPayload(
  attestation: ContributorAttestation,
): DirectPrincipalAttestationPayload {
  const parsed = validateContributorAttestation(attestation);
  if (parsed.format !== KHORA_DIRECT_PRINCIPAL_V1) {
    throw new Error(`Expected ${KHORA_DIRECT_PRINCIPAL_V1} attestation`);
  }
  const payload = decodeCanonicalPayload<DirectPrincipalAttestationPayload>(parsed.payload);
  if (payload.v !== 1) throw new Error("DirectPrincipalAttestationPayload.v must be 1");
  if (payload.principal !== parsed.principal) {
    throw new Error("DirectPrincipalAttestationPayload.principal must match attestation.principal");
  }
  return {
    v: 1,
    principal: requiredString(payload.principal, "DirectPrincipalAttestationPayload.principal"),
    issuedAt: requiredString(payload.issuedAt, "DirectPrincipalAttestationPayload.issuedAt"),
    scope: decodeDirectPrincipalScope(payload.scope),
    ...(payload.eventDigest !== undefined
      ? {
          eventDigest: optionalString(
            payload.eventDigest,
            "DirectPrincipalAttestationPayload.eventDigest",
          ),
        }
      : {}),
  };
}

export async function verifyDirectPrincipalAttestation(
  attestation: ContributorAttestation,
  verifier: DirectPrincipalVerifier,
): Promise<ContributorAttestationVerification> {
  const payload = decodeDirectPrincipalPayload(attestation);
  const payloadBytes = canonicalPayloadBytes(payload);
  const verified = await verifier({
    payload,
    payloadBytes,
    signature: base64UrlDecode(attestation.signature),
    attestation,
  });
  if (!verified) throw new Error("Direct principal attestation signature verification failed");
  return { format: KHORA_DIRECT_PRINCIPAL_V1, principal: attestation.principal, verified: true };
}
