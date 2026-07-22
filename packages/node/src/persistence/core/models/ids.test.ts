import { expect, test } from "bun:test";
import { ids, stableId } from "./ids";

test("stableId is deterministic", () => {
  expect(stableId("p", "a", "b")).toBe(stableId("p", "a", "b"));
});

test("ids helpers match expected stableId prefixes", () => {
  expect(ids.memory("ns", "k")).toBe(stableId("mem", "ns", "k"));
  expect(ids.edge("a", "b", "l", "x", "y")).toBe(stableId("edge", "a", "b", "l", "x", "y"));
});
