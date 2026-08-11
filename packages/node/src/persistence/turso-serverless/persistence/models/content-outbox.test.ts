import { describe, expect, test } from "bun:test";
import { mergeMemoryAsync } from "../../../../core/index";
import { sha256Hex } from "../../../../persistence/core/models/sha256";
import { queryOne } from "../client";
import {
  createMemoriesTursoServerlessPersistence,
  type MemoriesTursoServerlessPersistence,
} from "../persistence";
import { hasTursoIntegrationEnv, requireTursoIntegrationEnv } from "../test-harness";

const integration = hasTursoIntegrationEnv();

describe.skipIf(!integration)("turso content outbox smoke", () => {
  test("evacuate drops bodies outside hot window", async () => {
    const { url, authToken } = requireTursoIntegrationEnv();
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const persistence = await createMemoriesTursoServerlessPersistence({
      url,
      authToken,
      autoMigrate: true,
      contentOutboxRetentionTips: 1,
    });
    const turso = persistence as unknown as MemoriesTursoServerlessPersistence;

    await mergeMemoryAsync(
      { persistence },
      {
        key: `m1-${suffix}`,
        namespace: `outbox-smoke/${suffix}`,
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
        namespace: `outbox-smoke/${suffix}`,
        content: [{ key: "s", text: `new-turso-${suffix}` }],
        labels: [],
        edges: [],
      },
    );

    await turso.evacuateContentBlobs();

    const sha = sha256Hex(`old-turso-${suffix}`);
    const blob = await queryOne<{ location: string; text: string | null }>(
      turso.db.read,
      `SELECT location, text FROM memory_content_blobs WHERE content_sha256 = ?`,
      [sha],
    );
    expect(blob?.location).toBe("dropped");
    expect(blob?.text).toBeNull();

    expect(
      await turso.getMemoryContentAtRootHex(oldRoot, `outbox-smoke/${suffix}`, `m1-${suffix}`),
    ).toEqual([]);
  });
});
