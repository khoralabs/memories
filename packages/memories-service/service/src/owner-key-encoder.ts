import path from "node:path";

import type { MemoriesDatabaseId } from "./types";
import { validateMemoriesDatabaseId } from "./validate";

export const OWNER_KEY_ENCODING_VERSION = "v1";
export const DATABASE_FILENAME = "database.db";

export type OwnerKeyEncoder = {
  encodeDatabaseId(id: MemoriesDatabaseId): string;
  decodeDatabaseId(encoded: string): MemoriesDatabaseId;
  databasePathSegments(id: MemoriesDatabaseId): {
    version: string;
    encodedDatabaseId: string;
    filename: string;
  };
};

function bytesToBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function base64UrlToBytes(encoded: string): Uint8Array {
  return new Uint8Array(Buffer.from(encoded, "base64url"));
}

function canonicalDatabaseIdPayload(id: MemoriesDatabaseId): string {
  return JSON.stringify([id.kind, id.ownerKey]);
}

function parseDatabaseIdPayload(payload: string): MemoriesDatabaseId {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new Error("Encoded database id is invalid");
  }
  if (!Array.isArray(parsed) || parsed.length !== 2) {
    throw new Error("Encoded database id is invalid");
  }
  const [kind, ownerKey] = parsed;
  if (typeof kind !== "string" || typeof ownerKey !== "string") {
    throw new Error("Encoded database id is invalid");
  }
  return validateMemoriesDatabaseId({ kind, ownerKey });
}

export function createReversibleOwnerKeyEncoder(): OwnerKeyEncoder {
  return {
    encodeDatabaseId(id) {
      const validated = validateMemoriesDatabaseId(id);
      return bytesToBase64Url(new TextEncoder().encode(canonicalDatabaseIdPayload(validated)));
    },
    decodeDatabaseId(encoded) {
      const trimmed = encoded.trim();
      if (trimmed.length === 0) throw new Error("Encoded database id is required");
      const payload = new TextDecoder().decode(base64UrlToBytes(trimmed));
      return parseDatabaseIdPayload(payload);
    },
    databasePathSegments(id) {
      return {
        version: OWNER_KEY_ENCODING_VERSION,
        encodedDatabaseId: this.encodeDatabaseId(id),
        filename: DATABASE_FILENAME,
      };
    },
  };
}

export function resolveEncodedDatabasePath(
  dataDir: string,
  id: MemoriesDatabaseId,
  encoder: OwnerKeyEncoder = createReversibleOwnerKeyEncoder(),
): string {
  const validated = validateMemoriesDatabaseId(id);
  const segments = encoder.databasePathSegments(validated);
  return path.join(dataDir, segments.version, segments.encodedDatabaseId, segments.filename);
}
