import { describe, expect, test } from "bun:test";
import {
  sqlColumnStartsWithPrefix,
  sqlNamespaceEqualsOrUnderPrefix,
  sqlNamespaceEqualsOrUnderPrefixCol,
} from "./like-escape";

describe("like-escape", () => {
  test("sqlNamespaceEqualsOrUnderPrefix uses substr boundary", () => {
    expect(sqlNamespaceEqualsOrUnderPrefix("namespace")).toBe(
      `(namespace = ? OR substr(namespace, 1, length(?) + 1) = ? || '/')`,
    );
  });

  test("sqlNamespaceEqualsOrUnderPrefixCol compares against another column", () => {
    expect(sqlNamespaceEqualsOrUnderPrefixCol("m.namespace", "nm._id")).toBe(
      `(m.namespace = nm._id OR substr(m.namespace, 1, length(nm._id) + 1) = nm._id || '/')`,
    );
  });

  test("sqlColumnStartsWithPrefix uses substr equality", () => {
    expect(sqlColumnStartsWithPrefix("source_key")).toBe(`substr(source_key, 1, length(?)) = ?`);
  });
});
