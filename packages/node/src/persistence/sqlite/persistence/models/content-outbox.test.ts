import { describe, expect, test } from "bun:test";
import { deleteMemory, mergeMemory, replaceMemoryFeature } from "../../../../core/index";
import { sha256Hex } from "../../../../persistence/core/models/sha256";
import {
  createBunS3ContentBlobColdStore,
  createMemoriesPersistence,
  createMemoryContentBlobColdStore,
  openTestMemoriesDatabase,
} from "../index";

function requireHead(persistence: { getProvenanceHeadRootHex(): string | undefined }): string {
  const root = persistence.getProvenanceHeadRootHex();
  expect(root).toBeDefined();
  if (root === undefined) throw new Error("expected provenance head");
  return root;
}

describe("content outbox blobs + LWW", () => {
  test("dedupes identical bodies into one blob row", () => {
    const db = openTestMemoriesDatabase();
    const persistence = createMemoriesPersistence(db, { bunS3ColdStore: false });

    mergeMemory(
      { persistence },
      {
        key: "a",
        namespace: "ns",
        content: [{ key: "s1", text: "same-body" }],
        labels: [],
        edges: [],
      },
    );
    mergeMemory(
      { persistence },
      {
        key: "b",
        namespace: "ns",
        content: [{ key: "s1", text: "same-body" }],
        labels: [],
        edges: [],
      },
    );

    const blobCount = db
      .query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM memory_content_blobs`)
      .get()?.n;
    expect(blobCount).toBe(1);

    const hash = sha256Hex("same-body");
    const outboxNullText = db
      .query<{ n: number }, []>(
        `SELECT COUNT(*) AS n FROM memory_content_outbox WHERE text IS NOT NULL`,
      )
      .get()?.n;
    expect(outboxNullText).toBe(0);
    const hashed = db
      .query<{ n: number }, [string]>(
        `SELECT COUNT(*) AS n FROM memory_content_outbox WHERE content_sha256 = ?`,
      )
      .get(hash)?.n;
    expect(hashed).toBe(2);
  });

  test("LWW keeps prior arms after single-arm replace", () => {
    const db = openTestMemoriesDatabase();
    const persistence = createMemoriesPersistence(db, { bunS3ColdStore: false });
    const namespace = "ns";
    const key = "mem";

    mergeMemory(
      { persistence },
      {
        key,
        namespace,
        content: [
          { key: "alpha", text: "A" },
          { key: "beta", text: "B" },
        ],
        labels: [],
        edges: [],
      },
    );

    replaceMemoryFeature(
      { persistence },
      {
        namespace,
        key,
        sourceKey: "alpha",
        text: "A2",
      },
    );

    const root = requireHead(persistence);
    const hits = persistence.getMemoryContentAtRootHex(root, namespace, key);
    const bySource = Object.fromEntries(hits.map((h) => [h.sourceKey, h.text]));
    expect(bySource.alpha).toBe("A2");
    expect(bySource.beta).toBe("B");
  });

  test("DELETE_MEMORY tip clears arms; prior tip still reconstructs", () => {
    const db = openTestMemoriesDatabase();
    const persistence = createMemoriesPersistence(db, { bunS3ColdStore: false });

    mergeMemory(
      { persistence },
      {
        key: "mem",
        namespace: "ns",
        content: [{ key: "s", text: "alive" }],
        labels: [],
        edges: [],
      },
    );
    const mergeRoot = requireHead(persistence);

    deleteMemory({ persistence }, { namespace: "ns", key: "mem" });
    const deleteRoot = requireHead(persistence);
    expect(deleteRoot).not.toBe(mergeRoot);

    expect(persistence.getMemoryContentAtRootHex(mergeRoot, "ns", "mem")).toEqual([
      { namespace: "ns", memoryKey: "mem", sourceKey: "s", text: "alive" },
    ]);
    expect(persistence.getMemoryContentAtRootHex(deleteRoot, "ns", "mem")).toEqual([]);
  });

  test("legacy inline outbox.text reconstructs when content_sha256 is null", () => {
    const db = openTestMemoriesDatabase();
    const persistence = createMemoriesPersistence(db, { bunS3ColdStore: false });

    mergeMemory(
      { persistence },
      {
        key: "mem",
        namespace: "ns",
        content: [{ key: "s", text: "placeholder" }],
        labels: [],
        edges: [],
      },
    );
    const root = requireHead(persistence);

    db.run(
      `UPDATE memory_content_outbox
       SET content_sha256 = NULL, text = ?
       WHERE root_hex = ? AND source_key = ?`,
      ["legacy-inline", root, "s"],
    );

    expect(persistence.getMemoryContentAtRootHex(root, "ns", "mem")).toEqual([
      { namespace: "ns", memoryKey: "mem", sourceKey: "s", text: "legacy-inline" },
    ]);
  });

  test("without cold store, evacuate drops bodies but keeps thin outbox rows", async () => {
    const db = openTestMemoriesDatabase();
    const persistence = createMemoriesPersistence(db, {
      bunS3ColdStore: false,
      contentOutboxRetentionTips: 1,
    });

    mergeMemory(
      { persistence },
      {
        key: "m1",
        namespace: "ns",
        content: [{ key: "s", text: "old-text" }],
        labels: [],
        edges: [],
      },
    );
    const oldRoot = requireHead(persistence);

    mergeMemory(
      { persistence },
      {
        key: "m2",
        namespace: "ns",
        content: [{ key: "s", text: "new-text" }],
        labels: [],
        edges: [],
      },
    );

    await persistence.evacuateContentBlobs();

    const dropped = db
      .query<{ location: string; text: string | null }, [string]>(
        `SELECT location, text FROM memory_content_blobs WHERE content_sha256 = ?`,
      )
      .get(sha256Hex("old-text"));
    expect(dropped?.location).toBe("dropped");
    expect(dropped?.text).toBeNull();

    const outboxRows = db
      .query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM memory_content_outbox`)
      .get()?.n;
    expect(outboxRows).toBeGreaterThanOrEqual(2);

    const hotHits = persistence.getMemoryContentAtRootHex(oldRoot, "ns", "m1");
    expect(hotHits).toEqual([]);
  });

  test("retentionTips 0 never evacuates or drops bodies", async () => {
    const db = openTestMemoriesDatabase();
    const persistence = createMemoriesPersistence(db, {
      bunS3ColdStore: false,
      contentOutboxRetentionTips: 0,
    });

    mergeMemory(
      { persistence },
      {
        key: "m1",
        namespace: "ns",
        content: [{ key: "s", text: "keep-me" }],
        labels: [],
        edges: [],
      },
    );
    const oldRoot = requireHead(persistence);
    mergeMemory(
      { persistence },
      {
        key: "m2",
        namespace: "ns",
        content: [{ key: "s", text: "newer" }],
        labels: [],
        edges: [],
      },
    );

    await persistence.evacuateContentBlobs();

    const row = db
      .query<{ location: string; text: string | null }, [string]>(
        `SELECT location, text FROM memory_content_blobs WHERE content_sha256 = ?`,
      )
      .get(sha256Hex("keep-me"));
    expect(row?.location).toBe("hot");
    expect(row?.text).toBe("keep-me");
    expect(persistence.getMemoryContentAtRootHex(oldRoot, "ns", "m1")).toEqual([
      { namespace: "ns", memoryKey: "m1", sourceKey: "s", text: "keep-me" },
    ]);
  });

  test("blob still referenced by a hot tip is not evacuated", async () => {
    const db = openTestMemoriesDatabase();
    const persistence = createMemoriesPersistence(db, {
      bunS3ColdStore: false,
      contentOutboxRetentionTips: 1,
    });

    mergeMemory(
      { persistence },
      {
        key: "m1",
        namespace: "ns",
        content: [{ key: "s", text: "shared" }],
        labels: [],
        edges: [],
      },
    );
    mergeMemory(
      { persistence },
      {
        key: "m2",
        namespace: "ns",
        content: [{ key: "s", text: "shared" }],
        labels: [],
        edges: [],
      },
    );

    await persistence.evacuateContentBlobs();

    const row = db
      .query<{ location: string; text: string | null }, [string]>(
        `SELECT location, text FROM memory_content_blobs WHERE content_sha256 = ?`,
      )
      .get(sha256Hex("shared"));
    expect(row?.location).toBe("hot");
    expect(row?.text).toBe("shared");
  });

  test("rewrite rehydrates a previously dropped blob to hot", async () => {
    const db = openTestMemoriesDatabase();
    const persistence = createMemoriesPersistence(db, {
      bunS3ColdStore: false,
      contentOutboxRetentionTips: 1,
    });

    mergeMemory(
      { persistence },
      {
        key: "m1",
        namespace: "ns",
        content: [{ key: "s", text: "revive-me" }],
        labels: [],
        edges: [],
      },
    );
    mergeMemory(
      { persistence },
      {
        key: "m2",
        namespace: "ns",
        content: [{ key: "s", text: "other" }],
        labels: [],
        edges: [],
      },
    );
    await persistence.evacuateContentBlobs();
    expect(
      db
        .query<{ location: string }, [string]>(
          `SELECT location FROM memory_content_blobs WHERE content_sha256 = ?`,
        )
        .get(sha256Hex("revive-me"))?.location,
    ).toBe("dropped");

    mergeMemory(
      { persistence },
      {
        key: "m3",
        namespace: "ns",
        content: [{ key: "s", text: "revive-me" }],
        labels: [],
        edges: [],
      },
    );

    const row = db
      .query<{ location: string; text: string | null }, [string]>(
        `SELECT location, text FROM memory_content_blobs WHERE content_sha256 = ?`,
      )
      .get(sha256Hex("revive-me"));
    expect(row?.location).toBe("hot");
    expect(row?.text).toBe("revive-me");
  });

  test("with cold store, evacuate then async reconstruct returns text", async () => {
    const db = openTestMemoriesDatabase();
    const cold = createMemoryContentBlobColdStore();
    const persistence = createMemoriesPersistence(db, {
      bunS3ColdStore: false,
      contentBlobColdStore: cold,
      contentOutboxRetentionTips: 1,
    });

    mergeMemory(
      { persistence },
      {
        key: "m1",
        namespace: "ns",
        content: [{ key: "s", text: "cold-body" }],
        labels: [],
        edges: [],
      },
    );
    const oldRoot = requireHead(persistence);

    mergeMemory(
      { persistence },
      {
        key: "m2",
        namespace: "ns",
        content: [{ key: "s", text: "hot-body" }],
        labels: [],
        edges: [],
      },
    );

    await persistence.evacuateContentBlobs();

    const sha = sha256Hex("cold-body");
    expect(cold.map.has(sha)).toBe(true);
    const loc = db
      .query<{ location: string; text: string | null }, [string]>(
        `SELECT location, text FROM memory_content_blobs WHERE content_sha256 = ?`,
      )
      .get(sha);
    expect(loc?.location).toBe("cold");
    expect(loc?.text).toBeNull();

    expect(persistence.getMemoryContentAtRootHex(oldRoot, "ns", "m1")).toEqual([]);
    const asyncHits = await persistence.getMemoryContentAtRootHexAsync(oldRoot, "ns", "m1");
    expect(asyncHits).toEqual([
      { namespace: "ns", memoryKey: "m1", sourceKey: "s", text: "cold-body" },
    ]);

    const rehydrated = db
      .query<{ location: string; text: string | null }, [string]>(
        `SELECT location, text FROM memory_content_blobs WHERE content_sha256 = ?`,
      )
      .get(sha);
    expect(rehydrated?.location).toBe("hot");
    expect(rehydrated?.text).toBe("cold-body");
  });

  test("cold get with sha mismatch is treated as missing", async () => {
    const db = openTestMemoriesDatabase();
    const cold = createMemoryContentBlobColdStore();
    const persistence = createMemoriesPersistence(db, {
      bunS3ColdStore: false,
      contentBlobColdStore: cold,
      contentOutboxRetentionTips: 1,
    });

    mergeMemory(
      { persistence },
      {
        key: "m1",
        namespace: "ns",
        content: [{ key: "s", text: "real" }],
        labels: [],
        edges: [],
      },
    );
    const oldRoot = requireHead(persistence);
    mergeMemory(
      { persistence },
      {
        key: "m2",
        namespace: "ns",
        content: [{ key: "s", text: "later" }],
        labels: [],
        edges: [],
      },
    );
    await persistence.evacuateContentBlobs();

    const sha = sha256Hex("real");
    cold.map.set(sha, "tampered");
    const hits = await persistence.getMemoryContentAtRootHexAsync(oldRoot, "ns", "m1");
    expect(hits).toEqual([]);
  });

  test("createBunS3ContentBlobColdStore is disabled without a bucket", () => {
    const prevS3 = process.env.S3_BUCKET;
    const prevAws = process.env.AWS_BUCKET;
    delete process.env.S3_BUCKET;
    delete process.env.AWS_BUCKET;
    try {
      expect(createBunS3ContentBlobColdStore()).toBeUndefined();
      expect(createBunS3ContentBlobColdStore({ prefix: "x/" })).toBeUndefined();
    } finally {
      if (prevS3 !== undefined) process.env.S3_BUCKET = prevS3;
      else delete process.env.S3_BUCKET;
      if (prevAws !== undefined) process.env.AWS_BUCKET = prevAws;
      else delete process.env.AWS_BUCKET;
    }
  });

  test("createBunS3ContentBlobColdStore builds uriFor when bucket is set", () => {
    const store = createBunS3ContentBlobColdStore({
      bucket: "test-bucket",
      prefix: "memories/content-blobs/",
      s3: {
        accessKeyId: "test",
        secretAccessKey: "test",
        region: "us-east-1",
      },
    });
    expect(store).toBeDefined();
    expect(store?.uriFor("abc")).toBe("s3://test-bucket/memories/content-blobs/abc");
  });
});
