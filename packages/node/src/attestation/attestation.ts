import type { ContributorAttestation } from "../persistence/core/provenance";
import { canonicalJson } from "../persistence/core/provenance";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const BASE64URL_RE = /^[A-Za-z0-9_-]*$/;

export type {
  ContributorAttestation,
  MemoryMutationAttribution,
} from "../persistence/core/provenance";

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

export function base64UrlDecode(value: string): Uint8Array {
  if (!BASE64URL_RE.test(value)) throw new Error("base64url value contains invalid characters");
  const padded = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function canonicalPayloadBytes(payload: unknown): Uint8Array {
  return encoder.encode(canonicalJson(payload));
}

export function decodeCanonicalPayload<T = unknown>(payload: string): T {
  return JSON.parse(decoder.decode(base64UrlDecode(payload))) as T;
}

function assertString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function assertOptionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  return assertString(value, label);
}

function assertBase64Url(value: string, label: string): string {
  if (!BASE64URL_RE.test(value)) throw new Error(`${label} must be base64url encoded`);
  return value;
}

export function validateContributorAttestation(value: unknown): ContributorAttestation {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("ContributorAttestation must be an object");
  }
  const record = value as Record<string, unknown>;
  if (record.v !== 1) throw new Error("ContributorAttestation.v must be 1");
  const payload = assertBase64Url(
    assertString(record.payload, "ContributorAttestation.payload"),
    "ContributorAttestation.payload",
  );
  const signature = assertBase64Url(
    assertString(record.signature, "ContributorAttestation.signature"),
    "ContributorAttestation.signature",
  );
  return {
    v: 1,
    format: assertString(record.format, "ContributorAttestation.format"),
    principal: assertString(record.principal, "ContributorAttestation.principal"),
    payload,
    signature,
    ...(record.alg !== undefined
      ? { alg: assertOptionalString(record.alg, "ContributorAttestation.alg") }
      : {}),
    ...(record.keyId !== undefined
      ? { keyId: assertOptionalString(record.keyId, "ContributorAttestation.keyId") }
      : {}),
  };
}
