import { describe, expect, test } from "bun:test";
import { ids } from "../../persistence/core";
import {
  createMemoriesPersistence,
  openTestMemoriesDatabase,
} from "../../persistence/sqlite/persistence/index";
import { mergeMemory } from "../api/merge-memory";
import {
  calibrateSemanticDedupEpsilon,
  cosineSimilarity,
  defaultSemDeDupK,
  lexicalJaccard,
  loadSemanticDedupItems,
  planSemanticDedup,
  SEMDEDUP_PAPER,
  SEMDEDUP_PAPER_URL,
  type SemanticDedupItem,
} from "./semantic-dedup";

function unitVec(dim: number, hot: number): number[] {
  return Array.from({ length: dim }, (_, i) => (i === hot ? 1 : 0));
}

function nearVec(base: number[], noise = 0.01): number[] {
  return base.map((x, i) => x + (i % 3 === 0 ? noise : 0));
}

function item(
  key: string,
  embedding: number[],
  opts?: Partial<Pick<SemanticDedupItem, "createdAt" | "textLength" | "text" | "memoryId">>,
): SemanticDedupItem {
  return {
    memoryId: opts?.memoryId ?? `mem_${key}`,
    key,
    embedding,
    createdAt: opts?.createdAt ?? 1,
    textLength: opts?.textLength ?? opts?.text?.length ?? 0,
    text: opts?.text ?? "",
  };
}

describe("semantic-dedup primitives", () => {
  test("cites SemDeDup paper constants", () => {
    expect(SEMDEDUP_PAPER).toBe("arXiv:2303.09540");
    expect(SEMDEDUP_PAPER_URL).toContain("2303.09540");
  });

  test("cosineSimilarity on orthonormal axes", () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0);
  });

  test("lexicalJaccard rewards paraphrase overlap and rejects unrelated text", () => {
    expect(
      lexicalJaccard(
        "alice prefers dark roast coffee in the morning",
        "alice prefers dark roast coffee each morning",
      ),
    ).toBeGreaterThan(0.5);
    expect(lexicalJaccard("coffee preference", "quantum chromodynamics lattice")).toBeLessThan(0.1);
  });

  test("lexicalJaccard distinguishes single-character texts", () => {
    expect(lexicalJaccard("a", "b")).toBe(0);
    expect(lexicalJaccard("a", "a")).toBe(1);
  });

  test("defaultSemDeDupK clamps to N and prefers ~sqrt scale", () => {
    expect(defaultSemDeDupK(1)).toBe(1);
    expect(defaultSemDeDupK(10)).toBe(10);
    expect(defaultSemDeDupK(100)).toBe(16);
    expect(defaultSemDeDupK(10_000)).toBe(100);
  });
});

describe("planSemanticDedup", () => {
  test("plans and applies suppress for near-paraphrase pair; keeps distinct orthogonal memory", () => {
    const persistence = createMemoriesPersistence(openTestMemoriesDatabase());
    const ctx = { persistence };
    const namespace = "dedup/paraphrase";
    const vCoffee = unitVec(512, 0);
    const vCoffeeNear = nearVec(vCoffee, 0.02);
    const vQuantum = unitVec(512, 100);

    mergeMemory(ctx, {
      key: "coffee_a",
      namespace,
      content: [
        {
          key: "text",
          text: "alice prefers dark roast coffee in the morning",
          vector: vCoffee,
        },
      ],
      labels: [],
      edges: [],
    });
    // Newer / longer survivor candidate
    mergeMemory(ctx, {
      key: "coffee_b",
      namespace,
      content: [
        {
          key: "text",
          text: "alice prefers dark roast coffee in the morning every day without fail",
          vector: vCoffeeNear,
        },
      ],
      labels: [],
      edges: [],
    });
    mergeMemory(ctx, {
      key: "quantum",
      namespace,
      content: [
        {
          key: "text",
          text: "lattice gauge theory notes on quantum chromodynamics",
          vector: vQuantum,
        },
      ],
      labels: [],
      edges: [],
    });

    const loaded = loadSemanticDedupItems(persistence, namespace);
    expect(loaded.length).toBe(3);

    const planned = planSemanticDedup(ctx, {
      namespace,
      epsilon: 0.05,
      looseEpsilon: 0.5,
      k: 1,
      mode: "plan",
      seed: 7,
      minLexicalJaccard: 0.1,
    });

    expect(planned.paper).toBe(SEMDEDUP_PAPER);
    expect(planned.applied).toBe(0);
    const tight = planned.groups.filter((g) => g.band === "tight");
    expect(tight.length).toBe(1);
    expect(tight[0]?.keep.key).toBe("coffee_b");
    expect(tight[0]?.drop.map((d) => d.key)).toEqual(["coffee_a"]);
    expect(tight[0]?.drop.some((d) => d.key === "quantum")).toBe(false);

    const applied = planSemanticDedup(ctx, {
      namespace,
      epsilon: 0.05,
      k: 1,
      mode: "apply",
      seed: 7,
      minLexicalJaccard: 0.1,
    });
    expect(applied.applied).toBe(1);
    expect(persistence.isMemorySuppressed(ids.memory(namespace, "coffee_a"))).toBe(true);
    expect(persistence.isMemorySuppressed(ids.memory(namespace, "coffee_b"))).toBe(false);
    expect(persistence.isMemorySuppressed(ids.memory(namespace, "quantum"))).toBe(false);

    const head = persistence.listProvenanceEvents({
      namespace,
      key: "coffee_a",
      limit: 10,
    });
    const suppressEvt = head.find((e) => e.eventType === "SUPPRESS_MEMORY");
    expect(suppressEvt?.intentSnapshotId).toContain(SEMDEDUP_PAPER);
    expect(suppressEvt?.intentSnapshotId).toContain("peer=coffee_b");
  }, 15_000);

  test("lexical confirm blocks high-sim pair with unrelated text (FP guard)", () => {
    const persistence = createMemoriesPersistence(openTestMemoriesDatabase());
    const ctx = { persistence };
    const namespace = "dedup/fp";
    const v = unitVec(512, 3);

    mergeMemory(ctx, {
      key: "a",
      namespace,
      content: [{ key: "text", text: "alpha beta gamma delta", vector: v }],
      labels: [],
      edges: [],
    });
    mergeMemory(ctx, {
      key: "b",
      namespace,
      content: [
        {
          key: "text",
          text: "completely unrelated zebra yacht xylophone",
          vector: nearVec(v, 0.01),
        },
      ],
      labels: [],
      edges: [],
    });

    const blocked = planSemanticDedup(ctx, {
      namespace,
      epsilon: 0.05,
      k: 1,
      mode: "plan",
      minLexicalJaccard: 0.3,
      seed: 1,
    });
    expect(blocked.groups.filter((g) => g.band === "tight")).toHaveLength(0);

    const allowed = planSemanticDedup(ctx, {
      namespace,
      epsilon: 0.05,
      k: 1,
      mode: "plan",
      minLexicalJaccard: 0,
      seed: 1,
    });
    expect(allowed.groups.filter((g) => g.band === "tight").length).toBe(1);
  });

  test("loose band reports candidates without applying them", () => {
    const persistence = createMemoriesPersistence(openTestMemoriesDatabase());
    const ctx = { persistence };
    const namespace = "dedup/loose";
    // Moderate similarity: angle whose cos ≈ 0.8 → ε≈0.2 band
    const a = l2([1, 0, ...Array(510).fill(0)]);
    const b = l2([0.8, 0.6, ...Array(510).fill(0)]);

    mergeMemory(ctx, {
      key: "m1",
      namespace,
      content: [{ key: "text", text: "shared topic about hiking trails nearby", vector: a }],
      labels: [],
      edges: [],
    });
    mergeMemory(ctx, {
      key: "m2",
      namespace,
      content: [{ key: "text", text: "shared topic about hiking gear checklist", vector: b }],
      labels: [],
      edges: [],
    });

    const items = loadSemanticDedupItems(persistence, namespace);
    const e1 = items.find((i) => i.key === "m1")?.embedding;
    const e2 = items.find((i) => i.key === "m2")?.embedding;
    expect(e1).toBeDefined();
    expect(e2).toBeDefined();
    if (e1 === undefined || e2 === undefined) throw new Error("expected embeddings");
    const sim = cosineSimilarity(e1, e2);
    expect(sim).toBeGreaterThan(0.7);
    expect(sim).toBeLessThan(0.95);

    const result = planSemanticDedup(ctx, {
      namespace,
      epsilon: 0.02,
      looseEpsilon: 0.35,
      k: 1,
      mode: "apply",
      minLexicalJaccard: 0.05,
      seed: 2,
    });

    expect(result.groups.some((g) => g.band === "tight")).toBe(false);
    expect(result.groups.some((g) => g.band === "loose")).toBe(true);
    expect(result.applied).toBe(0);
    expect(persistence.isMemorySuppressed(ids.memory(namespace, "m1"))).toBe(false);
    expect(persistence.isMemorySuppressed(ids.memory(namespace, "m2"))).toBe(false);
  });

  test("calibrateSemanticDedupEpsilon returns finite ε for a tiny corpus", () => {
    const items = [
      item("a", [1, 0], { text: "one two three", createdAt: 1 }),
      item("b", [0.99, 0.01], { text: "one two three four", createdAt: 2 }),
      item("c", [0, 1], { text: "other topic entirely", createdAt: 3 }),
    ].map((i) => ({
      ...i,
      embedding: l2(i.embedding),
    }));
    const eps = calibrateSemanticDedupEpsilon(items, 0.7, {
      k: 1,
      seed: 3,
      minLexicalJaccard: 0,
      sampleFraction: 1,
    });
    expect(Number.isFinite(eps)).toBe(true);
    expect(eps).toBeGreaterThan(0);
  });

  test("lifts looseEpsilon when calibrated epsilon is not strictly smaller", () => {
    const persistence = createMemoriesPersistence(openTestMemoriesDatabase());
    const ctx = { persistence };
    const namespace = "dedup/loose-clamp";
    const v = unitVec(512, 0);
    mergeMemory(ctx, {
      key: "a",
      namespace,
      content: [{ key: "text", text: "alpha beta gamma", vector: v }],
      labels: [],
      edges: [],
    });
    mergeMemory(ctx, {
      key: "b",
      namespace,
      content: [{ key: "text", text: "alpha beta gamma delta", vector: nearVec(v, 0.02) }],
      labels: [],
      edges: [],
    });
    const result = planSemanticDedup(ctx, {
      namespace,
      targetKeepFraction: 0.5,
      looseEpsilon: 1e-12,
      k: 1,
      seed: 4,
      minLexicalJaccard: 0,
      mode: "plan",
    });
    expect(result.looseEpsilon).toBeDefined();
    expect(result.looseEpsilon ?? 0).toBeGreaterThan(result.epsilon);
  });

  test("apply emits suppress telemetry and counts only real suppresses", () => {
    const persistence = createMemoriesPersistence(openTestMemoriesDatabase());
    const ops: { op: string; ok?: boolean }[] = [];
    const telemetry = {
      emitOp(event: { op: string; ok?: boolean }) {
        ops.push({ op: event.op, ok: event.ok });
      },
      emitDatabaseLifecycle() {},
    };
    const ctx = { persistence, telemetry };
    const namespace = "dedup/telemetry";
    const v = unitVec(512, 0);
    mergeMemory(ctx, {
      key: "keep",
      namespace,
      content: [
        {
          key: "text",
          text: "alice prefers dark roast coffee in the morning",
          vector: nearVec(v, 0),
        },
      ],
      labels: [],
      edges: [],
    });
    mergeMemory(ctx, {
      key: "drop",
      namespace,
      content: [
        {
          key: "text",
          text: "alice prefers dark roast coffee each morning",
          vector: nearVec(v, 0.02),
        },
      ],
      labels: [],
      edges: [],
    });

    const first = planSemanticDedup(ctx, {
      namespace,
      epsilon: 0.05,
      k: 1,
      seed: 5,
      minLexicalJaccard: 0.05,
      mode: "apply",
    });
    expect(first.applied).toBeGreaterThanOrEqual(1);
    expect(ops.some((e) => e.op === "suppress" && e.ok === true)).toBe(true);

    const suppressOpsBefore = ops.filter((e) => e.op === "suppress").length;
    const second = planSemanticDedup(ctx, {
      namespace,
      epsilon: 0.05,
      k: 1,
      seed: 5,
      minLexicalJaccard: 0.05,
      mode: "apply",
    });
    expect(second.applied).toBe(0);
    expect(ops.filter((e) => e.op === "suppress").length).toBe(suppressOpsBefore);
  });

  test("fails closed on mixed embedding dimensions", () => {
    const persistence = createMemoriesPersistence(openTestMemoriesDatabase());
    const ctx = { persistence };
    const namespace = "dedup/dim";
    mergeMemory(ctx, {
      key: "a",
      namespace,
      content: [{ key: "text", text: "a", vector: unitVec(512, 0) }],
      labels: [],
      edges: [],
    });
    mergeMemory(ctx, {
      key: "b",
      namespace,
      content: [{ key: "text", text: "b", vector: unitVec(768, 0) }],
      labels: [],
      edges: [],
    });
    expect(() => loadSemanticDedupItems(persistence, namespace)).toThrow(/mixed embedding/);
  });
});

function l2(v: number[]): number[] {
  let s = 0;
  for (const x of v) s += x * x;
  const n = Math.sqrt(s);
  return n > 0 ? v.map((x) => x / n) : v;
}
