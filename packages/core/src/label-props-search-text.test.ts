import { describe, expect, test } from "bun:test";
import { propsToHumanSearchText } from "./models/label-props-search-text";

describe("propsToHumanSearchText", () => {
  test("emits readable lines without JSON delimiters", () => {
    const t = propsToHumanSearchText("person", {
      name: "Ada",
      role: "Engineer",
    });
    expect(t).toContain("Kind: person");
    expect(t).toContain("name: Ada");
    expect(t).toContain("role: Engineer");
    expect(t).not.toContain("{");
    expect(t).not.toContain("}");
  });

  test("returns empty for empty props", () => {
    expect(propsToHumanSearchText("person", {})).toBe("");
    expect(propsToHumanSearchText("person", undefined)).toBe("");
  });
});
