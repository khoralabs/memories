import { describe, expect, test } from "bun:test";
import type { SearchHit, SearchParams } from "../api/search.js";
import type { HybridMemorySearchClient } from "./memory-search-pipeline.js";
import {
  fuseNamespaceNodeAndLexicalArms,
  type NamespaceSearchHit,
  namespaceLineage,
  namespaceMetadataLexicalScore,
  type RankableMemoryHit,
  rankNamespacesFromHits,
  searchNamespaces,
} from "./namespace-search.js";

describe("namespaceLineage", () => {
  test("builds root-to-leaf prefixes", () => {
    expect(namespaceLineage("a/b/c")).toEqual(["a", "a/b", "a/b/c"]);
  });

  test("single segment", () => {
    expect(namespaceLineage("solo")).toEqual(["solo"]);
  });

  test("rejects invalid path", () => {
    expect(() => namespaceLineage("Bad/Path")).toThrow();
  });
});

describe("rankNamespacesFromHits", () => {
  test("empty hits", () => {
    expect(rankNamespacesFromHits([])).toEqual([]);
  });

  test("does not roll child scores into parent", () => {
    const hits: RankableMemoryHit[] = [
      { namespace: "a", memory_key: "p1", score: 0.1, kind: "node" },
      { namespace: "a/b", memory_key: "c1", score: 0.9, kind: "node" },
    ];
    const ranked = rankNamespacesFromHits(hits, { limit: 10 });
    expect(ranked.map((r) => r.namespace).sort()).toEqual(["a", "a/b"]);
    const parent = ranked.find((r) => r.namespace === "a");
    const child = ranked.find((r) => r.namespace === "a/b");
    expect(parent?.hitCount).toBe(1);
    expect(parent?.scoreSum).toBeCloseTo(0.1);
    expect(child?.hitCount).toBe(1);
    expect(child?.scoreSum).toBeCloseTo(0.9);
    expect(child?.lineage).toEqual(["a", "a/b"]);
  });

  test("volume formula prefers denser mid scores over single high when formula says so", () => {
    // ns dense: 3 × 0.4 → sum 1.2, score = 1.2 * (1 + log1p(3))
    // ns spike: 1 × 0.95 → sum 0.95, score = 0.95 * (1 + log1p(1))
    const denseScore = 1.2 * (1 + Math.log1p(3));
    const spikeScore = 0.95 * (1 + Math.log1p(1));
    expect(denseScore).toBeGreaterThan(spikeScore);

    const hits: RankableMemoryHit[] = [
      { namespace: "dense", memory_key: "a", score: 0.4, kind: "node" },
      { namespace: "dense", memory_key: "b", score: 0.4, kind: "node" },
      { namespace: "dense", memory_key: "c", score: 0.4, kind: "node" },
      { namespace: "spike", memory_key: "x", score: 0.95, kind: "node" },
    ];
    const ranked = rankNamespacesFromHits(hits);
    expect(ranked[0]?.namespace).toBe("dense");
    expect(ranked[0]?.score).toBeCloseTo(denseScore);
    expect(ranked[1]?.namespace).toBe("spike");
  });

  test("under filter keeps descendants inclusive", () => {
    const hits: RankableMemoryHit[] = [
      { namespace: "a", memory_key: "1", score: 1, kind: "node" },
      { namespace: "a/b", memory_key: "2", score: 1, kind: "node" },
      { namespace: "a/b/c", memory_key: "3", score: 1, kind: "node" },
      { namespace: "z", memory_key: "4", score: 9, kind: "node" },
    ];
    const ranked = rankNamespacesFromHits(hits, { under: "a/b" });
    expect(ranked.map((r) => r.namespace).sort()).toEqual(["a/b", "a/b/c"]);
  });

  test("limit 1 returns single best", () => {
    const hits: RankableMemoryHit[] = [
      { namespace: "b", memory_key: "1", score: 0.5, kind: "node" },
      { namespace: "a", memory_key: "2", score: 0.9, kind: "node" },
    ];
    const ranked = rankNamespacesFromHits(hits, { limit: 1 });
    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.namespace).toBe("a");
  });

  test("tie on score uses lexicographic namespace", () => {
    const hits: RankableMemoryHit[] = [
      { namespace: "m/b", memory_key: "1", score: 1, kind: "node" },
      { namespace: "m/a", memory_key: "2", score: 1, kind: "node" },
    ];
    const ranked = rankNamespacesFromHits(hits);
    expect(ranked.map((r) => r.namespace)).toEqual(["m/a", "m/b"]);
  });

  test("topHits capped and sorted by score", () => {
    const hits: RankableMemoryHit[] = [
      { namespace: "ns", memory_key: "low", score: 0.1, kind: "node" },
      { namespace: "ns", memory_key: "mid", score: 0.5, kind: "node" },
      { namespace: "ns", memory_key: "high", score: 0.9, kind: "node" },
      { namespace: "ns", memory_key: "also", score: 0.8, kind: "node" },
    ];
    const ranked = rankNamespacesFromHits(hits, { topHitsPerNamespace: 3 });
    expect(ranked[0]?.topHits.map((t) => t.memory_key)).toEqual(["high", "also", "mid"]);
  });

  test("lexical metadata boost can reorder namespaces", () => {
    const hits: RankableMemoryHit[] = [
      { namespace: "ops/a", memory_key: "1", score: 0.5, kind: "node" },
      { namespace: "ops/b", memory_key: "2", score: 0.55, kind: "node" },
    ];
    const without = rankNamespacesFromHits(hits);
    expect(without[0]?.namespace).toBe("ops/b");

    const withMeta = rankNamespacesFromHits(hits, {
      query: "inbox",
      metadata: [
        { namespace: "ops/a", alias: "Primary Inbox", description: "" },
        { namespace: "ops/b", alias: null, description: "misc notes" },
      ],
      metadataBoost: 0.5,
    });
    expect(withMeta[0]?.namespace).toBe("ops/a");
    const baseA = 0.5 * (1 + Math.log1p(1));
    const metaScore = namespaceMetadataLexicalScore("inbox", {
      namespace: "ops/a",
      alias: "Primary Inbox",
      description: "",
    });
    expect(withMeta[0]?.score).toBeCloseTo(baseA * (1 + 0.5 * metaScore));
  });

  test("metadataBoost 0 leaves content ranking unchanged", () => {
    const hits: RankableMemoryHit[] = [
      { namespace: "ops/a", memory_key: "1", score: 0.5, kind: "node" },
      { namespace: "ops/b", memory_key: "2", score: 0.55, kind: "node" },
    ];
    const ranked = rankNamespacesFromHits(hits, {
      query: "inbox",
      metadata: [{ namespace: "ops/a", alias: "Primary Inbox", description: "" }],
      metadataBoost: 0,
    });
    expect(ranked[0]?.namespace).toBe("ops/b");
  });
});

describe("fuseNamespaceNodeAndLexicalArms", () => {
  test("surfaces metadata-only namespaces via RRF", () => {
    const nodes: NamespaceSearchHit[] = [
      {
        namespace: "ops/b",
        lineage: ["ops", "ops/b"],
        score: 1,
        hitCount: 1,
        scoreSum: 0.9,
        scoreMax: 0.9,
        topHits: [{ memory_key: "x", score: 0.9, kind: "node" }],
      },
    ];
    const lexical: NamespaceSearchHit[] = [
      {
        namespace: "ops/a",
        lineage: ["ops", "ops/a"],
        score: 1,
        hitCount: 0,
        scoreSum: 1,
        scoreMax: 1,
        topHits: [],
      },
      {
        namespace: "ops/b",
        lineage: ["ops", "ops/b"],
        score: 0.2,
        hitCount: 0,
        scoreSum: 0.2,
        scoreMax: 0.2,
        topHits: [],
      },
    ];
    const fused = fuseNamespaceNodeAndLexicalArms(nodes, lexical, {
      nodesWeight: 1,
      lexicalWeight: 1,
      limit: 10,
    });
    expect(fused.map((n) => n.namespace).sort()).toEqual(["ops/a", "ops/b"]);
    const a = fused.find((n) => n.namespace === "ops/a");
    expect(a?.hitCount).toBe(0);
    expect(a?.topHits).toEqual([]);
    const b = fused.find((n) => n.namespace === "ops/b");
    expect(b?.hitCount).toBe(1);
    expect(b?.topHits[0]?.memory_key).toBe("x");
  });

  test("higher nodes weight prefers nodes ranking order", () => {
    const nodes: NamespaceSearchHit[] = [
      {
        namespace: "ns/strong",
        lineage: ["ns", "ns/strong"],
        score: 1,
        hitCount: 1,
        scoreSum: 1,
        scoreMax: 1,
        topHits: [],
      },
      {
        namespace: "ns/weak",
        lineage: ["ns", "ns/weak"],
        score: 0.5,
        hitCount: 1,
        scoreSum: 0.5,
        scoreMax: 0.5,
        topHits: [],
      },
    ];
    const lexical: NamespaceSearchHit[] = [
      {
        namespace: "ns/weak",
        lineage: ["ns", "ns/weak"],
        score: 1,
        hitCount: 0,
        scoreSum: 1,
        scoreMax: 1,
        topHits: [],
      },
      {
        namespace: "ns/strong",
        lineage: ["ns", "ns/strong"],
        score: 0.1,
        hitCount: 0,
        scoreSum: 0.1,
        scoreMax: 0.1,
        topHits: [],
      },
    ];
    const fused = fuseNamespaceNodeAndLexicalArms(nodes, lexical, {
      nodesWeight: 10,
      lexicalWeight: 0.1,
      limit: 2,
    });
    expect(fused[0]?.namespace).toBe("ns/strong");
  });
});

describe("namespaceMetadataLexicalScore", () => {
  test("matches alias tokens", () => {
    expect(
      namespaceMetadataLexicalScore("primary inbox", {
        namespace: "ops/mail",
        alias: "Primary Inbox",
        description: "",
      }),
    ).toBe(1);
  });

  test("partial token coverage", () => {
    expect(
      namespaceMetadataLexicalScore("inbox foo", {
        namespace: "ops/mail",
        alias: "Inbox",
        description: "",
      }),
    ).toBeCloseTo(0.5);
  });
});

function mockHit(partial: {
  namespace: string;
  key: string;
  score: number;
  kind?: "node" | "edge";
}): SearchHit {
  const kind = partial.kind ?? "node";
  return {
    _id: `sm_${partial.key}`,
    _ts_created: 0,
    memory_id: `mem_${partial.key}`,
    source_key: "text",
    score: partial.score,
    memory: {
      _id: `mem_${partial.key}`,
      _ts_created: 0,
      namespace: partial.namespace,
      key: partial.key,
      kind,
    },
    labels: [],
    graph:
      kind === "edge"
        ? {
            kind: "edge",
            edge: {
              edgeId: "e1",
              fromKey: "a",
              toKey: "b",
              labels: [],
            },
          }
        : { kind: "node" },
  } as SearchHit;
}

function mockClient(opts: {
  search: (params: SearchParams) => { hits: SearchHit[] } | never;
  listNamespacesWithMetadata?: () => Array<{
    namespace: string;
    alias: string | null;
    description: string;
  }>;
}): HybridMemorySearchClient {
  return {
    persistence: {
      listNamespacesWithMetadata: opts.listNamespacesWithMetadata ?? (() => [] as const),
    },
    search: opts.search,
  } as unknown as HybridMemorySearchClient;
}

describe("searchNamespaces", () => {
  test("empty query returns empty without calling search", async () => {
    let called = false;
    const client = mockClient({
      search: () => {
        called = true;
        return { hits: [] };
      },
    });

    const result = await searchNamespaces(
      client,
      { namespace: "_root_" },
      { content: { text: "   " } },
    );
    expect(called).toBe(false);
    expect(result).toEqual({ query: "", under: null, namespaces: [] });
  });

  test("throws clear error when unscoped search unsupported", async () => {
    const client = mockClient({
      search: () => {
        throw new Error("unscoped search not supported by this persistence");
      },
    });

    await expect(
      searchNamespaces(client, { namespace: "_root_" }, { content: { text: "hello" } }),
    ).rejects.toThrow(/searchNamespaces requires unscopedSearch/);
  });

  test("aggregates multi-ns hits with lineage and topHits", async () => {
    const calls: SearchParams[] = [];
    const client = mockClient({
      search: (params) => {
        calls.push(params);
        return {
          hits: [
            mockHit({ namespace: "team", key: "t1", score: 0.2 }),
            mockHit({ namespace: "team/proj", key: "p1", score: 0.8 }),
            mockHit({ namespace: "team/proj", key: "p2", score: 0.5 }),
            mockHit({ namespace: "team/proj", key: "edge1", score: 0.99, kind: "edge" }),
          ],
        };
      },
      listNamespacesWithMetadata: () => [
        { namespace: "team", alias: null, description: "" },
        { namespace: "team/proj", alias: "Project", description: "roadmap work" },
      ],
    });

    const result = await searchNamespaces(
      client,
      { namespace: "_root_" },
      { content: { text: "roadmap" }, under: "team", limit: 10 },
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.searchEntireDatabase).toBe(true);
    expect(calls[0]?.namespace).toBe("team");
    expect(result.query).toBe("roadmap");
    expect(result.under).toBe("team");

    const namespaces = result.namespaces.map((n) => n.namespace).sort();
    expect(namespaces).toEqual(["team", "team/proj"]);

    const proj = result.namespaces.find((n) => n.namespace === "team/proj");
    expect(proj?.lineage).toEqual(["team", "team/proj"]);
    expect(proj?.hitCount).toBe(2); // edge filtered out
    expect(proj?.topHits[0]?.memory_key).toBe("p1");
    expect(proj?.topHits.every((t) => t.kind === "node")).toBe(true);
  });

  test("vector-only does not call listNamespacesWithMetadata", async () => {
    let listed = false;
    const client = mockClient({
      search: () => ({
        hits: [mockHit({ namespace: "ns", key: "k1", score: 0.5 })],
      }),
      listNamespacesWithMetadata: () => {
        listed = true;
        return [];
      },
    });

    const cacheKey = `_root_\nsearchEntireDatabase\nhello`;
    await searchNamespaces(
      client,
      {
        namespace: "_root_",
        // Cache hit avoids calling the real embedding pipeline.
        embeddingModel: {} as never,
        embeddingCache: new Map([[cacheKey, [0.1, 0.2]]]),
      },
      { content: { text: "hello" }, arms: { lexical: 0, vector: 1 } },
    );
    expect(listed).toBe(false);
  });

  test("nodes+lexical RRF surfaces metadata-only namespace", async () => {
    const client = mockClient({
      search: () => ({
        hits: [mockHit({ namespace: "ops/hits", key: "k1", score: 0.4 })],
      }),
      listNamespacesWithMetadata: () => [
        { namespace: "ops/hits", alias: null, description: "" },
        { namespace: "ops/inbox", alias: "Primary Inbox", description: "" },
      ],
    });

    const result = await searchNamespaces(
      client,
      { namespace: "_root_" },
      {
        content: { text: "inbox" },
        arms: { nodes: 1, lexical: 1, vector: 0 },
        under: "ops",
        limit: 10,
      },
    );

    expect(result.namespaces.map((n) => n.namespace).sort()).toEqual(["ops/hits", "ops/inbox"]);
    const inbox = result.namespaces.find((n) => n.namespace === "ops/inbox");
    expect(inbox?.hitCount).toBe(0);
    expect(inbox?.topHits).toEqual([]);
  });

  test("nodes=0 lexical-only ranks catalog without calling search", async () => {
    let searched = false;
    const client = mockClient({
      search: () => {
        searched = true;
        return { hits: [] };
      },
      listNamespacesWithMetadata: () => [
        { namespace: "ops/mail", alias: "Primary Inbox", description: "" },
        { namespace: "ops/other", alias: null, description: "misc" },
        { namespace: "z/skip", alias: "Inbox", description: "" },
      ],
    });

    const result = await searchNamespaces(
      client,
      { namespace: "_root_" },
      {
        content: { text: "inbox" },
        arms: { nodes: 0, lexical: 1 },
        under: "ops",
        limit: 10,
      },
    );

    expect(searched).toBe(false);
    expect(result.namespaces.map((n) => n.namespace)).toEqual(["ops/mail"]);
    expect(result.namespaces[0]?.topHits).toEqual([]);
    expect(result.namespaces[0]?.hitCount).toBe(0);
    expect(result.namespaces[0]?.score).toBeGreaterThan(0);
  });

  test("nodes>0 with lexical=0 skips metadata boost listing", async () => {
    let listed = false;
    const client = mockClient({
      search: () => ({
        hits: [mockHit({ namespace: "ns", key: "k1", score: 0.5 })],
      }),
      listNamespacesWithMetadata: () => {
        listed = true;
        return [{ namespace: "ns", alias: "hello", description: "" }];
      },
    });

    const cacheKey = `_root_\nsearchEntireDatabase\nhello`;
    await searchNamespaces(
      client,
      {
        namespace: "_root_",
        embeddingModel: {} as never,
        embeddingCache: new Map([[cacheKey, [0.1, 0.2]]]),
      },
      { content: { text: "hello" }, arms: { nodes: 1, lexical: 0, vector: 1 } },
    );
    expect(listed).toBe(false);
  });

  test("throws when nodes and lexical are both zero", async () => {
    const client = mockClient({
      search: () => ({ hits: [] }),
    });
    await expect(
      searchNamespaces(
        client,
        { namespace: "_root_" },
        { content: { text: "x" }, arms: { nodes: 0, lexical: 0, vector: 1 } },
      ),
    ).rejects.toThrow(/arms\.nodes or arms\.lexical/);
  });

  test("uses content.vector without embeddingModel when arms.vector > 0", async () => {
    let seen: { vector?: number[] } | undefined;
    const client = mockClient({
      search: (params) => {
        seen = params.content as { vector?: number[] };
        return { hits: [mockHit({ namespace: "ns", key: "k1", score: 0.5 })] };
      },
    });
    const vector = Array.from({ length: 512 }, (_, i) => (i === 0 ? 1 : 0));
    await searchNamespaces(
      client,
      { namespace: "_root_" },
      {
        content: { text: "hello", vector },
        arms: { nodes: 1, lexical: 0, vector: 1 },
      },
    );
    expect(seen?.vector).toEqual(vector);
  });

  test("rejects invalid content.vector length when arms.vector > 0", async () => {
    const client = mockClient({ search: () => ({ hits: [] }) });
    await expect(
      searchNamespaces(
        client,
        { namespace: "_root_" },
        {
          content: { text: "hello", vector: [1, 2, 3] },
          arms: { nodes: 1, lexical: 0, vector: 1 },
        },
      ),
    ).rejects.toThrow();
  });
});
