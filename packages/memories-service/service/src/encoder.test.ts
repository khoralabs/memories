import { describe, expect, test } from "bun:test";

import { createReversibleOwnerKeyEncoder, OWNER_KEY_ENCODING_VERSION } from "./owner-key-encoder";

describe("owner key encoder", () => {
  test("encodes owner keys to path-safe reversible segments", () => {
    const encoder = createReversibleOwnerKeyEncoder();
    const encoded = encoder.encodeOwnerKey(
      "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLdPbLKarWNt1XL",
    );
    expect(encoded.includes("/")).toBe(false);
    expect(encoded.includes("\\")).toBe(false);
    expect(encoder.decodeOwnerKey(encoded)).toBe(
      "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLdPbLKarWNt1XL",
    );
  });

  test("uses versioned layout segments", () => {
    const encoder = createReversibleOwnerKeyEncoder();
    const segments = encoder.databasePathSegments({
      kind: "account",
      ownerKey: "user-1",
    });
    expect(segments.version).toBe(OWNER_KEY_ENCODING_VERSION);
    expect(segments.kind).toBe("account");
    expect(segments.filename.endsWith(".db")).toBe(true);
  });
});
