import type { Memory, SearchHit, SearchParams } from "@khoralabs/memories-core";
import { afterEach, describe, expect, it } from "vitest";
import { start } from "workflow/api";
import {
  provideAutolinkSession,
  releaseAutolinkSession,
  resetAutolinkSessionRegistryForTests,
} from "../session.js";
import { autolinkIntegrate } from "./autolink-integrate.js";

function nodeHit(key: string, score: number): SearchHit {
  const memory = {
    namespace: "demo",
    key,
    kind: "node",
  } as Memory;
  return {
    _id: `sm-${key}`,
    _ts_created: 0,
    memory_id: `mem-${key}`,
    source_key: "src",
    score,
    memory,
    labels: [],
    graph: { kind: "node" },
  } as SearchHit;
}

afterEach(() => {
  resetAutolinkSessionRegistryForTests();
});

describe("autolinkIntegrate via Local World", () => {
  it("start(autolinkIntegrate) search-links via session client", async () => {
    const merges: unknown[] = [];
    const client = {
      search(_params: SearchParams) {
        return [nodeHit("n1", 0.9)];
      },
      mergeMemory(params: unknown) {
        merges.push(params);
        return ["mem-focal"];
      },
    };

    const sessionId = "autolink-integration";
    provideAutolinkSession(sessionId, { client: client as never });

    try {
      const run = await start(autolinkIntegrate, [
        {
          sessionId,
          namespace: "demo",
          key: "focal",
          content: [{ key: "body", text: "hello" }],
          searchContent: { text: "hello" },
          linkPlan: { topK: 5 },
        },
      ]);

      const result = await run.returnValue;
      expect(result).toEqual(["mem-focal"]);
      expect(merges).toHaveLength(1);
      const merge = merges[0] as { edges?: Array<{ memory_key: string }> };
      expect(merge.edges?.map((e) => e.memory_key)).toEqual(["n1"]);
    } finally {
      releaseAutolinkSession(sessionId);
    }
  });
});
