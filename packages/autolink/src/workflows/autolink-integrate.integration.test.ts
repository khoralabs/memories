import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Memory, SearchHit, SearchParams } from "@khoralabs/memories-core";
import { buildWorkflowTests, setupWorkflowTests, teardownWorkflowTests } from "@workflow/vitest";
import { Agent } from "undici";
import { start } from "workflow/api";
import {
  provideAutolinkSession,
  releaseAutolinkSession,
  resetAutolinkSessionRegistryForTests,
} from "../session.js";
import { autolinkIntegrate } from "./autolink-integrate.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

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

/**
 * Bun does not run the Workflow SWC transform. Stamp `workflowId` from the
 * bundle that `buildWorkflowTests` just wrote (same id the transform would add).
 */
async function attachWorkflowIdFromBundle(
  fn: typeof autolinkIntegrate,
  exportName: string,
): Promise<void> {
  const bundle = await readFile(join(packageRoot, ".workflow-vitest/workflows.mjs"), "utf8");
  const match = bundle.match(new RegExp(`${exportName}\\.workflowId = "([^"]+)"`));
  if (!match?.[1]) {
    throw new Error(
      `attachWorkflowIdFromBundle: no workflowId for ${exportName} in .workflow-vitest/workflows.mjs`,
    );
  }
  (fn as { workflowId?: string }).workflowId = match[1];
}

beforeAll(async () => {
  // Bun's undici Agent may lack `close()`. Local World teardown calls it.
  const proto = Agent.prototype as { close?: () => unknown };
  if (typeof proto.close !== "function") {
    proto.close = () => undefined;
  }

  await buildWorkflowTests({ cwd: packageRoot, rootDir: packageRoot });
  await setupWorkflowTests({ cwd: packageRoot, rootDir: packageRoot });
  await attachWorkflowIdFromBundle(autolinkIntegrate, "autolinkIntegrate");
});

afterAll(async () => {
  await teardownWorkflowTests();
});

afterEach(() => {
  resetAutolinkSessionRegistryForTests();
});

describe("autolinkIntegrate via Local World", () => {
  test("start(autolinkIntegrate) search-links via session client", async () => {
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
