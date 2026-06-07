import { describe, expect, test } from "bun:test";
import { labelPropertySyntheticEmbedding } from "./label-property-features";

describe("labelPropertySyntheticEmbedding", () => {
  test("empty inputs yield zero vector after normalization convention", () => {
    const v = labelPropertySyntheticEmbedding([], null, 8);
    expect(v.length).toBe(8);
    expect(v.every((x) => x === 0)).toBe(true);
  });

  test("deterministic for same labels and properties", () => {
    const a = labelPropertySyntheticEmbedding([{ kind: "fact", props: {} }], { x: 1 }, 16);
    const b = labelPropertySyntheticEmbedding([{ kind: "fact", props: {} }], { x: 1 }, 16);
    expect(a).toEqual(b);
  });
});
