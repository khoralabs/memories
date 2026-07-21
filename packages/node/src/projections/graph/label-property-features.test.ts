import { describe, expect, test } from "bun:test";
import { labelPropertySyntheticEmbedding } from "./label-property-features";

describe("labelPropertySyntheticEmbedding", () => {
  test("is deterministic and normalized", () => {
    const a = labelPropertySyntheticEmbedding([{ kind: "Task", props: { status: "open" } }], {
      priority: 1,
    });
    const b = labelPropertySyntheticEmbedding([{ kind: "Task", props: { status: "open" } }], {
      priority: 1,
    });
    expect(a).toEqual(b);
    expect(Math.sqrt(a.reduce((sum, x) => sum + x * x, 0))).toBeCloseTo(1);
  });
});
