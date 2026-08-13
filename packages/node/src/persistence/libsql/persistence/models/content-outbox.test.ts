import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deleteMemoryAsync,
  mergeMemoryAsync,
  replaceMemoryFeatureAsync,
} from "../../../../core/index";
import { sha256Hex } from "../../../../persistence/core/models/sha256";
import type { MemoriesPersistenceAsync } from "../../../../persistence/core/persistence";
import type { ContentBlobColdStore } from "../../../../persistence/core/persistence/content-blob-cold-store";
import { queryOne } from "../client";
import { createMemoriesLibsqlPersistence, type MemoriesLibsqlPersistence } from "../persistence";

function memoryColdStore(): ContentBlobColdStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    uriFor(sha) {
      return `memory://${sha}`;
    },
    async put(sha, text) {
      map.set(sha, text);
    },
    async get(sha) {
      return map.get(sha) ?? null;
    },
  };
}

type LibsqlOutboxHarness = {
  persistence: MemoriesPersistenceAsync;
  /** Concrete backend for evacuate / content-at-root / raw SQL. */
  libsql: MemoriesLibsqlPersistence;
};

async function openLibsql(opts?: {
  contentOutboxRetentionTips?: number;
  contentBlobColdStore?: ContentBlobColdStore;
  allowDropWithoutColdStore?: boolean;
}): Promise<LibsqlOutboxHarness> {
  const dir = mkdtempSync(join(tmpdir(), "memories-libsql-outbox-"));
  const persistence = await createMemoriesLibsqlPersistence({
    url: `file:${join(dir, "test.db")}`,
    autoMigrate: true,
    contentOutboxRetentionTips: opts?.contentOutboxRetentionTips,
    contentBlobColdStore: opts?.contentBlobColdStore,
    allowDropWithoutColdStore: opts?.allowDropWithoutColdStore,
  });
  return {
    persistence,
    libsql: persistence as unknown as MemoriesLibsqlPersistence,
  };
}

async function requireHead(persistence: MemoriesPersistenceAsync): Promise<string> {
  const root = await persistence.getProvenanceHeadRootHex();
  expect(root).toBeDefined();
  if (root === undefined) throw new Error("expected provenance head");
  return root;
}

describe("libsql content outbox", () => {
  test("thin append stores hash; evacuate drops bodies outside hot window", async () => {
    const { persistence, libsql } = await openLibsql({
      contentOutboxRetentionTips: 1,
      allowDropWithoutColdStore: true,
    });

    await mergeMemoryAsync(
      { persistence },
      {
        key: "m1",
        namespace: "ns",
        content: [{ key: "s", text: "old-libsql" }],
        labels: [],
        edges: [],
      },
    );
    const oldRoot = await requireHead(persistence);

    await mergeMemoryAsync(
      { persistence },
      {
        key: "m2",
        namespace: "ns",
        content: [{ key: "s", text: "new-libsql" }],
        labels: [],
        edges: [],
      },
    );

    await libsql.evacuateContentBlobs();

    const sha = sha256Hex("old-libsql");
    const blob = await queryOne<{ location: string; text: string | null }>(
      libsql.db.client,
      `SELECT location, text FROM memory_content_blobs WHERE content_sha256 = ?`,
      [sha],
    );
    expect(blob?.location).toBe("dropped");
    expect(blob?.text).toBeNull();

    const outboxText = await queryOne<{ n: number }>(
      libsql.db.client,
      `SELECT COUNT(*) AS n FROM memory_content_outbox WHERE text IS NOT NULL`,
    );
    expect(outboxText?.n).toBe(0);

    expect(await libsql.getMemoryContentAtRootHex(oldRoot, "ns", "m1")).toEqual([]);
  });

  test("with cold store, evacuate then reconstruct returns text", async () => {
    const cold = memoryColdStore();
    const { persistence, libsql } = await openLibsql({
      contentOutboxRetentionTips: 1,
      contentBlobColdStore: cold,
    });

    await mergeMemoryAsync(
      { persistence },
      {
        key: "m1",
        namespace: "ns",
        content: [{ key: "s", text: "cold-libsql" }],
        labels: [],
        edges: [],
      },
    );
    const oldRoot = await requireHead(persistence);

    await mergeMemoryAsync(
      { persistence },
      {
        key: "m2",
        namespace: "ns",
        content: [{ key: "s", text: "hot-libsql" }],
        labels: [],
        edges: [],
      },
    );

    await libsql.evacuateContentBlobs();
    const sha = sha256Hex("cold-libsql");
    expect(cold.map.has(sha)).toBe(true);

    const hits = await libsql.getMemoryContentAtRootHex(oldRoot, "ns", "m1");
    expect(hits).toEqual([
      { namespace: "ns", memoryKey: "m1", sourceKey: "s", text: "cold-libsql" },
    ]);
  });

  test("LWW keeps prior arms after single-arm replace", async () => {
    const { persistence, libsql } = await openLibsql();
    const namespace = "ns";
    const key = "mem";

    await mergeMemoryAsync(
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

    await replaceMemoryFeatureAsync(
      { persistence },
      {
        namespace,
        key,
        sourceKey: "alpha",
        text: "A2",
      },
    );

    const root = await requireHead(persistence);
    const hits = await libsql.getMemoryContentAtRootHex(root, namespace, key);
    const bySource = Object.fromEntries(hits.map((h) => [h.sourceKey, h.text]));
    expect(bySource.alpha).toBe("A2");
    expect(bySource.beta).toBe("B");
  });

  test("DELETE_MEMORY tip clears arms; prior tip still reconstructs", async () => {
    const { persistence, libsql } = await openLibsql();

    await mergeMemoryAsync(
      { persistence },
      {
        key: "mem",
        namespace: "ns",
        content: [{ key: "s", text: "alive" }],
        labels: [],
        edges: [],
      },
    );
    const mergeRoot = await requireHead(persistence);

    await deleteMemoryAsync({ persistence }, { namespace: "ns", key: "mem" });
    const deleteRoot = await requireHead(persistence);
    expect(deleteRoot).not.toBe(mergeRoot);

    expect(await libsql.getMemoryContentAtRootHex(mergeRoot, "ns", "mem")).toEqual([
      { namespace: "ns", memoryKey: "mem", sourceKey: "s", text: "alive" },
    ]);
    expect(await libsql.getMemoryContentAtRootHex(deleteRoot, "ns", "mem")).toEqual([]);
  });

  test("without cold store, default evacuate is a no-op and retains hot bodies", async () => {
    const { persistence, libsql } = await openLibsql({
      contentOutboxRetentionTips: 1,
    });

    await mergeMemoryAsync(
      { persistence },
      {
        key: "m1",
        namespace: "ns",
        content: [{ key: "s", text: "retain-me" }],
        labels: [],
        edges: [],
      },
    );
    const oldRoot = await requireHead(persistence);

    await mergeMemoryAsync(
      { persistence },
      {
        key: "m2",
        namespace: "ns",
        content: [{ key: "s", text: "newer" }],
        labels: [],
        edges: [],
      },
    );

    await libsql.evacuateContentBlobs();

    const row = await queryOne<{ location: string; text: string | null }>(
      libsql.db.client,
      `SELECT location, text FROM memory_content_blobs WHERE content_sha256 = ?`,
      [sha256Hex("retain-me")],
    );
    expect(row?.location).toBe("hot");
    expect(row?.text).toBe("retain-me");
    expect(await libsql.getMemoryContentAtRootHex(oldRoot, "ns", "m1")).toEqual([
      { namespace: "ns", memoryKey: "m1", sourceKey: "s", text: "retain-me" },
    ]);
  });

  test("empty-string hot body is valid and reconstructs", async () => {
    const { persistence, libsql } = await openLibsql();

    await mergeMemoryAsync(
      { persistence },
      {
        key: "empty",
        namespace: "ns",
        content: [{ key: "s", text: "" }],
        labels: [],
        edges: [],
      },
    );
    const root = await requireHead(persistence);

    const blob = await queryOne<{ location: string; text: string | null }>(
      libsql.db.client,
      `SELECT location, text FROM memory_content_blobs WHERE content_sha256 = ?`,
      [sha256Hex("")],
    );
    expect(blob?.location).toBe("hot");
    expect(blob?.text).toBe("");

    expect(await libsql.getMemoryContentAtRootHex(root, "ns", "empty")).toEqual([
      { namespace: "ns", memoryKey: "empty", sourceKey: "s", text: "" },
    ]);
  });

  test("retentionTips 0 never evacuates or drops bodies", async () => {
    const { persistence, libsql } = await openLibsql({
      contentOutboxRetentionTips: 0,
      allowDropWithoutColdStore: true,
    });

    await mergeMemoryAsync(
      { persistence },
      {
        key: "m1",
        namespace: "ns",
        content: [{ key: "s", text: "keep-me" }],
        labels: [],
        edges: [],
      },
    );
    const oldRoot = await requireHead(persistence);
    await mergeMemoryAsync(
      { persistence },
      {
        key: "m2",
        namespace: "ns",
        content: [{ key: "s", text: "newer" }],
        labels: [],
        edges: [],
      },
    );

    await libsql.evacuateContentBlobs();

    const row = await queryOne<{ location: string; text: string | null }>(
      libsql.db.client,
      `SELECT location, text FROM memory_content_blobs WHERE content_sha256 = ?`,
      [sha256Hex("keep-me")],
    );
    expect(row?.location).toBe("hot");
    expect(row?.text).toBe("keep-me");
    expect(await libsql.getMemoryContentAtRootHex(oldRoot, "ns", "m1")).toEqual([
      { namespace: "ns", memoryKey: "m1", sourceKey: "s", text: "keep-me" },
    ]);
  });

  test("blob still referenced by a hot tip is not evacuated", async () => {
    const { persistence, libsql } = await openLibsql({
      allowDropWithoutColdStore: true,
      contentOutboxRetentionTips: 1,
    });

    await mergeMemoryAsync(
      { persistence },
      {
        key: "m1",
        namespace: "ns",
        content: [{ key: "s", text: "shared" }],
        labels: [],
        edges: [],
      },
    );
    await mergeMemoryAsync(
      { persistence },
      {
        key: "m2",
        namespace: "ns",
        content: [{ key: "s", text: "shared" }],
        labels: [],
        edges: [],
      },
    );

    await libsql.evacuateContentBlobs();

    const row = await queryOne<{ location: string; text: string | null }>(
      libsql.db.client,
      `SELECT location, text FROM memory_content_blobs WHERE content_sha256 = ?`,
      [sha256Hex("shared")],
    );
    expect(row?.location).toBe("hot");
    expect(row?.text).toBe("shared");
  });

  test("rewrite rehydrates a previously dropped blob to hot", async () => {
    const { persistence, libsql } = await openLibsql({
      allowDropWithoutColdStore: true,
      contentOutboxRetentionTips: 1,
    });

    await mergeMemoryAsync(
      { persistence },
      {
        key: "m1",
        namespace: "ns",
        content: [{ key: "s", text: "revive-me" }],
        labels: [],
        edges: [],
      },
    );
    await mergeMemoryAsync(
      { persistence },
      {
        key: "m2",
        namespace: "ns",
        content: [{ key: "s", text: "other" }],
        labels: [],
        edges: [],
      },
    );
    await libsql.evacuateContentBlobs();
    expect(
      (
        await queryOne<{ location: string }>(
          libsql.db.client,
          `SELECT location FROM memory_content_blobs WHERE content_sha256 = ?`,
          [sha256Hex("revive-me")],
        )
      )?.location,
    ).toBe("dropped");

    await mergeMemoryAsync(
      { persistence },
      {
        key: "m3",
        namespace: "ns",
        content: [{ key: "s", text: "revive-me" }],
        labels: [],
        edges: [],
      },
    );

    const row = await queryOne<{ location: string; text: string | null }>(
      libsql.db.client,
      `SELECT location, text FROM memory_content_blobs WHERE content_sha256 = ?`,
      [sha256Hex("revive-me")],
    );
    expect(row?.location).toBe("hot");
    expect(row?.text).toBe("revive-me");
  });

  test("cold get with sha mismatch is treated as missing", async () => {
    const cold = memoryColdStore();
    const { persistence, libsql } = await openLibsql({
      contentBlobColdStore: cold,
      contentOutboxRetentionTips: 1,
    });

    await mergeMemoryAsync(
      { persistence },
      {
        key: "m1",
        namespace: "ns",
        content: [{ key: "s", text: "real" }],
        labels: [],
        edges: [],
      },
    );
    const oldRoot = await requireHead(persistence);
    await mergeMemoryAsync(
      { persistence },
      {
        key: "m2",
        namespace: "ns",
        content: [{ key: "s", text: "later" }],
        labels: [],
        edges: [],
      },
    );
    await libsql.evacuateContentBlobs();

    const sha = sha256Hex("real");
    cold.map.set(sha, "tampered");
    const hits = await libsql.getMemoryContentAtRootHex(oldRoot, "ns", "m1");
    expect(hits).toEqual([]);
  });
});
