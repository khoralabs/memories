import { describe, expect, test } from "bun:test";

import { DEFAULT_SQLITE_STRATEGY_CAPABILITIES, resolveStrategyCapabilities } from "./backend";

describe("resolveStrategyCapabilities", () => {
  test("sqlite strategy defaults to full sqlite backend capabilities", () => {
    expect(
      resolveStrategyCapabilities({
        kind: "sqlite",
        dataDir: "/data",
        sqlCipherKey: "key",
      }),
    ).toEqual(DEFAULT_SQLITE_STRATEGY_CAPABILITIES);
  });

  test("sqlite strategy merges capability overrides", () => {
    expect(
      resolveStrategyCapabilities({
        kind: "sqlite",
        dataDir: "/data",
        capabilities: { vectorSearch: false, unscopedSearch: false },
      }),
    ).toEqual({
      ...DEFAULT_SQLITE_STRATEGY_CAPABILITIES,
      vectorSearch: false,
      unscopedSearch: false,
    });
  });

  test("unknown strategy kind uses core defaults when capabilities omitted", () => {
    expect(resolveStrategyCapabilities({ kind: "remote", endpoint: "https://x" })).toEqual({
      lexicalSearch: true,
      vectorSearch: true,
      neighborIndex: true,
      graphIndex: true,
      multiNamespaceSearch: true,
      unscopedSearch: false,
    });
  });

  test("unknown strategy kind merges explicit capability overrides", () => {
    expect(
      resolveStrategyCapabilities({
        kind: "remote",
        endpoint: "https://x",
        capabilities: { vectorSearch: false, graphIndex: false },
      }),
    ).toEqual({
      lexicalSearch: true,
      vectorSearch: false,
      neighborIndex: true,
      graphIndex: false,
      multiNamespaceSearch: true,
      unscopedSearch: false,
    });
  });
});
