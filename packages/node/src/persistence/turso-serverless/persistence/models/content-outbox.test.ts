import { describe, expect, test } from "bun:test";
import { mergeMemoryAsync, replaceMemoryFeatureAsync } from "../../../../core/index";
import { sha256Hex } from "../../../../persistence/core/models/sha256";
import type { ContentBlobColdStore } from "../../../../persistence/core/persistence/content-blob-cold-store";
import { queryOne } from "../client";
import {
  createMemoriesTursoServerlessPersistence,
  type MemoriesTursoServerlessPersistence,
} from "../persistence";
import { hasTursoIntegrationEnv, requireTursoIntegrationEnv } from "../test-harness";

const integration = hasTursoIntegrationEnv();

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

describe.skipIf(!integration)("turso content outbox smoke", () => {
  test("evacuate drops bodies outside hot window", async () => {
    const { url, authToken } = requireTursoIntegrationEnv();
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const ns = `outbox-smoke/${suffix}`;
    const persistence = await createMemoriesTursoServerlessPersistence({
      url,
      authToken,
      autoMigrate: true,
      contentOutboxRetentionTips: 1,
      allowDropWithoutColdStore: true,
    });
    const turso = persistence as unknown as MemoriesTursoServerlessPersistence;

    await mergeMemoryAsync(
      { persistence },
      {
        key: `m1-${suffix}`,
        namespace: ns,
        content: [{ key: "s", text: `old-turso-${suffix}` }],
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
        key: `m2-${suffix}`,
        namespace: ns,
        content: [{ key: "s", text: `new-turso-${suffix}` }],
        labels: [],
        edges: [],
      },
    );

    await turso.evacuateContentBlobs();

    const sha = sha256Hex(`old-turso-${suffix}`);
    const blobRow = await queryOne<{ location: string; payload: Uint8Array | null }>(
      turso.db.read,
      `SELECT location, payload FROM memory_tip_blobs WHERE content_sha256 = ?`,
      [sha],
    );
    expect(blobRow?.location).toBe("dropped");
    expect(blobRow?.payload).toBeNull();

    expect(await turso.getMemoryContentAtRootHex(oldRoot, ns, `m1-${suffix}`)).toEqual([]);
  });

  test("with cold store, evacuate then reconstruct returns text", async () => {
    const { url, authToken } = requireTursoIntegrationEnv();
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const ns = `outbox-cold/${suffix}`;
    const cold = memoryColdStore();
    const persistence = await createMemoriesTursoServerlessPersistence({
      url,
      authToken,
      autoMigrate: true,
      contentOutboxRetentionTips: 1,
      contentBlobColdStore: cold,
    });
    const turso = persistence as unknown as MemoriesTursoServerlessPersistence;

    await mergeMemoryAsync(
      { persistence },
      {
        key: `m1-${suffix}`,
        namespace: ns,
        content: [{ key: "s", text: `cold-turso-${suffix}` }],
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
        key: `m2-${suffix}`,
        namespace: ns,
        content: [{ key: "s", text: `hot-turso-${suffix}` }],
        labels: [],
        edges: [],
      },
    );

    await turso.evacuateContentBlobs();
    const sha = sha256Hex(`cold-turso-${suffix}`);
    expect(cold.map.has(sha)).toBe(true);

    const hits = await turso.getMemoryContentAtRootHex(oldRoot, ns, `m1-${suffix}`);
    expect(hits).toEqual([
      {
        namespace: ns,
        memoryKey: `m1-${suffix}`,
        sourceKey: "s",
        text: `cold-turso-${suffix}`,
      },
    ]);
  });

  test("LWW keeps prior arms after single-arm replace", async () => {
    const { url, authToken } = requireTursoIntegrationEnv();
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const ns = `outbox-lww/${suffix}`;
    const key = `mem-${suffix}`;
    const persistence = await createMemoriesTursoServerlessPersistence({
      url,
      authToken,
      autoMigrate: true,
    });
    const turso = persistence as unknown as MemoriesTursoServerlessPersistence;

    await mergeMemoryAsync(
      { persistence },
      {
        key,
        namespace: ns,
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
        namespace: ns,
        key,
        sourceKey: "alpha",
        text: "A2",
      },
    );

    const root = await persistence.getProvenanceHeadRootHex();
    expect(root).toBeDefined();
    if (root === undefined) return;

    const hits = await turso.getMemoryContentAtRootHex(root, ns, key);
    const bySource = Object.fromEntries(hits.map((h) => [h.sourceKey, h.text]));
    expect(bySource.alpha).toBe("A2");
    expect(bySource.beta).toBe("B");
  });
});
