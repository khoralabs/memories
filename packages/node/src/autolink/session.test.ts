import { afterEach, describe, expect, test } from "bun:test";
import {
  getAutolinkSession,
  provideAutolinkSession,
  releaseAutolinkSession,
  requireAutolinkSession,
  resetAutolinkSessionRegistryForTests,
} from "./session.js";

afterEach(() => {
  resetAutolinkSessionRegistryForTests();
});

describe("autolink session registry", () => {
  test("provide / require / release", () => {
    const client = { search: () => ({ hits: [] }), mergeMemory: () => [] } as never;
    provideAutolinkSession("s1", { client });
    expect(requireAutolinkSession("s1").client).toBe(client);
    expect(getAutolinkSession("s1")?.client).toBe(client);
    expect(releaseAutolinkSession("s1")?.client).toBe(client);
    expect(getAutolinkSession("s1")).toBeUndefined();
  });

  test("require throws when missing", () => {
    expect(() => requireAutolinkSession("missing")).toThrow(/not active/);
  });

  test("rejects empty sessionId", () => {
    expect(() => provideAutolinkSession("", { client: {} as never })).toThrow(/non-empty/);
  });
});
