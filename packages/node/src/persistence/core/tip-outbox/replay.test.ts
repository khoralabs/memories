import { describe, expect, test } from "bun:test";
import { encodeTipGraphSnapshot } from "./graph-snapshot";
import { float32Bytes } from "./payload";
import { replayVectorArmsAtRootHex } from "./replay";
import type { TipOutboxSqlDeps } from "./types";

describe("tip outbox replay", () => {
  test("replayVectorArmsAtRootHex decodes float32 payloads", async () => {
    const vec = [0.1, 0.2, 0.3];
    const bytes = float32Bytes(vec);
    const deps: TipOutboxSqlDeps = {
      queryAll: async <T extends Record<string, unknown>>() =>
        [
          {
            facet: "vector",
            namespace: "ns",
            memoryKey: "k",
            sourceKey: "emb",
            edgeId: null,
            payloadSha256: "sha",
            blobBytes: bytes,
            blobText: null,
            location: "hot",
            coldUri: null,
          },
        ] as unknown as T[],
      exec: async () => {},
    };
    const arms = await replayVectorArmsAtRootHex(deps, "aa".repeat(32), "ns", "k");
    expect(arms[0]?.sourceKey).toBe("emb");
    expect(arms[0]?.vector[0]).toBeCloseTo(0.1);
    expect(arms[0]?.vector[1]).toBeCloseTo(0.2);
  });

  test("encodeTipGraphSnapshot roundtrips key fields", () => {
    const bytes = encodeTipGraphSnapshot({
      v: 1,
      kind: "node",
      namespace: "ns",
      memoryKey: "k",
      suppressed: false,
      labels: [{ kind: "Person" }],
      properties: { role: "admin" },
    });
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    expect(parsed.kind).toBe("node");
    expect(parsed.labels[0].kind).toBe("Person");
  });
});
