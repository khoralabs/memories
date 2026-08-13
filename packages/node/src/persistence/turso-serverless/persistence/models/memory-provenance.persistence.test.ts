import { describe, expect, test } from "bun:test";
import { ids, mergeMemoryAsync } from "../../../../core/index";
import {
  canonicalJson,
  computeSourceMapContentHash,
  GENESIS_PARENT_HEX,
  nextProvenanceRoot,
} from "../../../../persistence/core/provenance";
import { queryOne } from "../client";
import {
  createMemoriesTursoServerlessPersistence,
  type MemoriesTursoServerlessPersistence,
} from "../persistence";
import { hasTursoIntegrationEnv, requireTursoIntegrationEnv } from "../test-harness";

const integration = hasTursoIntegrationEnv();

/**
 * Turso schema fidelity smoke for provenance rows (env-gated).
 * List/chain behavior is covered by the shared contract when credentials exist.
 */
describe.skipIf(!integration)("memory provenance SQL (turso smoke)", () => {
  test("first provenance row links genesis parent and stores canonical event_json", async () => {
    const { url, authToken } = requireTursoIntegrationEnv();
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const namespace = `prov-smoke/${suffix}`;
    const key = `mem-${suffix}`;
    const memoryId = ids.memory(namespace, key);
    const persistence = await createMemoriesTursoServerlessPersistence({
      url,
      authToken,
      autoMigrate: true,
    });
    const turso = persistence as unknown as MemoriesTursoServerlessPersistence;

    const parentBefore = await persistence.getProvenanceHeadRootHex();

    await mergeMemoryAsync(
      { persistence },
      {
        key,
        namespace,
        content: [{ key: "alpha", text: "hello" }],
        labels: [],
        edges: [],
      },
    );

    const event = {
      v: 1 as const,
      kind: "MERGE_MEMORY" as const,
      namespace,
      memory_key: key,
      memory_id: memoryId,
      source_keys: ["alpha"],
      content_hashes: {
        alpha: computeSourceMapContentHash({ text: "hello" }),
      },
    };
    const head = await persistence.getProvenanceHeadRootHex();
    expect(head).toBe(nextProvenanceRoot(parentBefore, event).root_hex);

    const row = await queryOne<{
      parent_root_hex: string;
      event_type: string;
      event_json: string;
    }>(
      turso.db.read,
      `SELECT parent_root_hex, event_type, event_json FROM memory_provenance WHERE root_hex = ? LIMIT 1`,
      [head],
    );
    expect(row?.parent_root_hex).toBe(parentBefore ?? GENESIS_PARENT_HEX);
    expect(row?.event_type).toBe("MERGE_MEMORY");
    expect(row?.event_json).toBe(canonicalJson(event));
  });
});
