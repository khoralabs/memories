import { describe, expect, test } from "bun:test";
import { adaptArm, fuseRrf, rankIds } from "./index.js";

describe("fuseRrf", () => {
  test("fuses multiple arms with default settings", () => {
    const out = rankIds([
      { armId: "lexical", ranked: ["a", "b", "c"] },
      { armId: "vector", ranked: ["b", "d", "a"] },
    ]);
    expect(out[0]).toBe("b");
  });

  test("applies arm and item boosts", () => {
    const out = fuseRrf(
      [
        { armId: "lexical", ranked: ["a", "b", "c"], weight: 1 },
        { armId: "vector", ranked: ["c", "b", "a"], weight: 2 },
      ],
      { itemBoosts: { a: 3 } },
    );
    expect(out[0]?.id).toBe("a");
    expect(out[0]?.contributions.length).toBe(2);
  });

  test("adapts scored items into an arm", () => {
    const lexical = adaptArm({
      armId: "lexical",
      items: [
        { entryId: "a", score: 0.2 },
        { entryId: "b", score: 0.8 },
      ],
      getId: (x) => x.entryId,
      getScore: (x) => x.score,
      scoreToBoost: (s) => 1 + s,
    });
    const vector = adaptArm({
      armId: "vector",
      items: [{ id: "a" }, { id: "c" }],
      getId: (x) => x.id,
    });
    const out = rankIds([lexical, vector]);
    expect(out[0]).toBe("a");
    expect(out).toContain("c");
  });
});
