import { describe, expect, test } from "bun:test";
import { mergeMemory } from "../../../../core/index";
import { createMemoriesPersistence, openTestMemoriesDatabase } from "../index";
import { listNamespacesUnderPrefix } from "./list-namespaces-under-prefix";

describe("listNamespacesUnderPrefix underscore path boundary", () => {
  test("prefix user_a does not match sibling userxa", () => {
    const db = openTestMemoriesDatabase();
    const persistence = createMemoriesPersistence(db, { bunS3ColdStore: false });

    mergeMemory(
      { persistence },
      {
        key: "a",
        namespace: "user_a",
        content: [{ key: "body", text: "a" }],
        labels: [],
        edges: [],
      },
    );
    mergeMemory(
      { persistence },
      {
        key: "child",
        namespace: "user_a/child",
        content: [{ key: "body", text: "child" }],
        labels: [],
        edges: [],
      },
    );
    mergeMemory(
      { persistence },
      {
        key: "x",
        namespace: "userxa",
        content: [{ key: "body", text: "x" }],
        labels: [],
        edges: [],
      },
    );
    mergeMemory(
      { persistence },
      {
        key: "xchild",
        namespace: "userxa/child",
        content: [{ key: "body", text: "xchild" }],
        labels: [],
        edges: [],
      },
    );

    const listed = listNamespacesUnderPrefix(db, "user_a");
    expect(listed).toContain("user_a");
    expect(listed).toContain("user_a/child");
    expect(listed).not.toContain("userxa");
    expect(listed).not.toContain("userxa/child");
    expect(listed.every((ns) => ns === "user_a" || ns.startsWith("user_a/"))).toBe(true);
  });
});
