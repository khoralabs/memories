import { describe, expect, test } from "bun:test";
import type { MemoriesClientAsync } from "../api/client-async";
import { mergeLogicalMemoryWithMergeSlice } from "./merge-logical-memory";

/** Stand-in for a remote client whose class is a different `MemoriesClientAsync` copy. */
function createDuckTypedAsyncClient(mergeKeys: string[] = ["note-1"]) {
  let mergeCalls = 0;
  const client = {
    persistence: {
      capabilities: { vectorSearch: false },
      withTransaction: async <T>(fn: () => Promise<T>) => fn(),
    },
    async mergeMemory() {
      mergeCalls += 1;
      return mergeKeys;
    },
  };
  return {
    client: client as unknown as MemoriesClientAsync<Record<string, never>, Record<string, never>>,
    get mergeCalls() {
      return mergeCalls;
    },
  };
}

describe("mergeLogicalMemoryWithMergeSlice", () => {
  test("treats thenable mergeMemory as async (no instanceof MemoriesClientAsync)", async () => {
    const duck = createDuckTypedAsyncClient(["note-1"]);
    // Would throw `metaSyncedKeys.map is not a function` if sync path ran on a Promise.
    await mergeLogicalMemoryWithMergeSlice(
      duck.client,
      {
        key: "note-1",
        namespace: "app/user",
        content: [{ key: "text", text: "hello" }],
      },
      { labels: [], edges: [], properties: {} },
      {
        embed: async () => {
          throw new Error("embed should not run when vectorSearch is false / stub persistence");
        },
      } as never,
    );
    expect(duck.mergeCalls).toBe(1);
  });
});
