import { describe, expect, test } from "bun:test";
import { namespacePathsFromMetadata } from "./namespace-metadata-paths";

describe("namespacePathsFromMetadata", () => {
  test("maps namespace paths in order", () => {
    expect(namespacePathsFromMetadata([{ namespace: "a" }, { namespace: "b/c" }])).toEqual([
      "a",
      "b/c",
    ]);
  });
});
