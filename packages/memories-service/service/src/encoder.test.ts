import { describe, expect, test } from "bun:test";

import {
  createReversibleOwnerKeyEncoder,
  DATABASE_FILENAME,
  OWNER_KEY_ENCODING_VERSION,
} from "./owner-key-encoder";

describe("database id encoder", () => {
  test("encodes database ids to path-safe reversible segments", () => {
    const encoder = createReversibleOwnerKeyEncoder();
    const id = {
      kind: "account",
      ownerKey: "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLdPbLKarWNt1XL",
    };
    const encoded = encoder.encodeDatabaseId(id);
    expect(encoded.includes("/")).toBe(false);
    expect(encoded.includes("\\")).toBe(false);
    expect(encoder.decodeDatabaseId(encoded)).toEqual(id);
  });

  test("uses flat versioned layout segments", () => {
    const encoder = createReversibleOwnerKeyEncoder();
    const segments = encoder.databasePathSegments({
      kind: "account",
      ownerKey: "user-1",
    });
    expect(segments.version).toBe(OWNER_KEY_ENCODING_VERSION);
    expect(segments.encodedDatabaseId.length).toBeGreaterThan(0);
    expect(segments.filename).toBe(DATABASE_FILENAME);
    expect("kind" in segments).toBe(false);
  });

  test("distinguishes same owner key across kinds", () => {
    const encoder = createReversibleOwnerKeyEncoder();
    const ownerKey = "shared-owner";
    const account = encoder.encodeDatabaseId({ kind: "account", ownerKey });
    const organization = encoder.encodeDatabaseId({ kind: "organization", ownerKey });
    expect(account).not.toBe(organization);
  });
});
