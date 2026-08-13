import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";

import { isSafeMetaPropertyName, MemoryMetadata } from "./memory-metadata.js";
import { ensureDom } from "./test/ensure-dom.js";

ensureDom();

afterEach(() => {
  cleanup();
});

describe("isSafeMetaPropertyName", () => {
  test("allows token-like keys", () => {
    expect(isSafeMetaPropertyName("foo")).toBe(true);
    expect(isSafeMetaPropertyName("title_1")).toBe(true);
    expect(isSafeMetaPropertyName("a.b:c-d")).toBe(true);
  });

  test("rejects hostile or spaced keys", () => {
    expect(isSafeMetaPropertyName("a b")).toBe(false);
    expect(isSafeMetaPropertyName('"><img onerror=alert(1)>')).toBe(false);
    expect(isSafeMetaPropertyName("")).toBe(false);
    expect(isSafeMetaPropertyName("_leading")).toBe(false);
    expect(isSafeMetaPropertyName(null)).toBe(false);
    expect(isSafeMetaPropertyName(undefined)).toBe(false);
  });
});

describe("MemoryMetadata", () => {
  test("emits meta for safe keys only; lists all keys in the visible UI", () => {
    const hostile = '"><img onerror=x>';
    const props = {
      kind: "node" as const,
      memoryKey: "n1",
      namespace: "acme",
      properties: { foo: "bar", [hostile]: "nope", "a b": "spaced" },
    };

    const markup = renderToStaticMarkup(<MemoryMetadata {...props} />);
    expect(markup).toContain('name="memory:property:foo"');
    expect(markup).toContain('content="bar"');
    expect(markup).not.toContain("memory:property:a b");
    expect(markup).not.toMatch(/name="memory:property:[^"]*onerror/);

    const { container } = render(<MemoryMetadata {...props} />);
    expect(container.textContent).toContain("foo");
    expect(container.textContent).toContain("bar");
    expect(container.textContent).toContain(hostile);
    expect(container.textContent).toContain("a b");
  });
});
