import { sha256Hex } from "../models/sha256";
import { canonicalJson } from "./canonical-json";

const enc = new TextEncoder();

/** Domain prefix for source-map body digests (distinct from event leaves). */
export const MEMORIES_SOURCE_BODY_V1_PREFIX = "MEMORIES_SOURCE_BODY_v1\0";

export interface SourceMapBodyParts {
  text?: string;
  vector?: Float32Array;
}

/**
 * `SHA-256(MEMORIES_SOURCE_BODY_v1 || NUL || canonical_json(descriptor))` as lowercase hex,
 * where descriptor carries derived sha256s of text / raw vector bytes (no giant JSON).
 */
export function computeSourceMapContentHash(parts: SourceMapBodyParts): string {
  const text_present = parts.text !== undefined;
  const vector_present = parts.vector !== undefined;
  const text_sha256 = parts.text !== undefined ? sha256Hex(enc.encode(parts.text)) : undefined;
  const vector_dim = parts.vector !== undefined ? parts.vector.length : undefined;
  const vector_sha256 =
    parts.vector !== undefined
      ? sha256Hex(
          new Uint8Array(parts.vector.buffer, parts.vector.byteOffset, parts.vector.byteLength),
        )
      : undefined;

  const descriptor = {
    text_present,
    text_sha256,
    vector_dim,
    vector_present,
    vector_sha256,
  };
  const payload = enc.encode(`${MEMORIES_SOURCE_BODY_V1_PREFIX}${canonicalJson(descriptor)}`);
  return sha256Hex(payload);
}
