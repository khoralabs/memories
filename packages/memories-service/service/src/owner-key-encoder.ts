import path from "node:path";

import type { MemoriesDatabaseId } from "./types";
import { validateDatabaseKind, validateMemoriesDatabaseId, validateOwnerKey } from "./validate";

export const OWNER_KEY_ENCODING_VERSION = "v1";

export type OwnerKeyEncoder = {
  encodeOwnerKey(ownerKey: string): string;
  decodeOwnerKey(encoded: string): string;
  databasePathSegments(id: MemoriesDatabaseId): {
    version: string;
    kind: string;
    encodedOwnerKey: string;
    filename: string;
  };
};

function bytesToBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function base64UrlToBytes(encoded: string): Uint8Array {
  return new Uint8Array(Buffer.from(encoded, "base64url"));
}

export function createReversibleOwnerKeyEncoder(): OwnerKeyEncoder {
  return {
    encodeOwnerKey(ownerKey: string): string {
      const validated = validateOwnerKey(ownerKey);
      return bytesToBase64Url(new TextEncoder().encode(validated));
    },
    decodeOwnerKey(encoded: string): string {
      const trimmed = encoded.trim();
      if (trimmed.length === 0) throw new Error("Encoded owner key is required");
      const decoded = new TextDecoder().decode(base64UrlToBytes(trimmed));
      return validateOwnerKey(decoded);
    },
    databasePathSegments(id: MemoriesDatabaseId) {
      const kind = validateDatabaseKind(id.kind);
      const encodedOwnerKey = this.encodeOwnerKey(id.ownerKey);
      return {
        version: OWNER_KEY_ENCODING_VERSION,
        kind,
        encodedOwnerKey,
        filename: `${encodedOwnerKey}.db`,
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
  return path.join(
    dataDir,
    segments.version,
    segments.kind,
    segments.encodedOwnerKey,
    segments.filename,
  );
}
