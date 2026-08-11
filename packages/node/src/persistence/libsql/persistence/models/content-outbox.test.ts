import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mergeMemoryAsync } from "../../../../core/index";
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
}): Promise<LibsqlOutboxHarness> {
  const dir = mkdtempSync(join(tmpdir(), "memories-libsql-outbox-"));
  const persistence = await createMemoriesLibsqlPersistence({
    url: `file:${join(dir, "test.db")}`,
    autoMigrate: true,
    contentOutboxRetentionTips: opts?.contentOutboxRetentionTips,
    contentBlobColdStore: opts?.contentBlobColdStore,
  });
  return {
    persistence,
    libsql: persistence as unknown as MemoriesLibsqlPersistence,
  };
}

describe("libsql content outbox smoke", () => {
  test("thin append stores hash; evacuate drops bodies outside hot window", async () => {
    const { persistence, libsql } = await openLibsql({ contentOutboxRetentionTips: 1 });

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
    const oldRoot = await persistence.getProvenanceHeadRootHex();
    expect(oldRoot).toBeDefined();
    if (oldRoot === undefined) return;

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
    const oldRoot = await persistence.getProvenanceHeadRootHex();
    expect(oldRoot).toBeDefined();
    if (oldRoot === undefined) return;

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
});
