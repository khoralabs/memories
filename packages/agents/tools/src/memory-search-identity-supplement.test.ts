import { expect, test } from "bun:test";
import { memorySearchIdentityLinkSupplement } from "./memory-search-toolkit.js";

test("memorySearchIdentityLinkSupplement wires runtime augments + invocation context", () => {
  const o = memorySearchIdentityLinkSupplement({ memoriesSnapshotRootHex: "deadbeef" });
  expect(o.runtimeToolAugments?.memory_search).toBe("deadbeef");
  expect(o.invocationContext?.memoriesProvenanceRootHex).toBe("deadbeef");
  expect(o.invocationContextAllowlist).toEqual(["memoriesProvenanceRootHex"]);
});

test("memorySearchIdentityLinkSupplement is empty when snapshot unset", () => {
  expect(memorySearchIdentityLinkSupplement({})).toEqual({});
});
