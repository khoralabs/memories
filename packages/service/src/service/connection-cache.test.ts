import { describe, expect, test } from "bun:test";

import type { MemoriesDatabaseHandle } from "./backend";
import {
  createConnectionCache,
  getCachedConnection,
  releaseCachedConnection,
  setCachedConnection,
} from "./connection-cache";

function mockHandle(): MemoriesDatabaseHandle & {
  events: string[];
} {
  const events: string[] = [];
  return {
    events,
    persistence: {} as MemoriesDatabaseHandle["persistence"],
    async close() {
      events.push("close");
    },
    async checkpoint() {
      events.push("checkpoint");
    },
  };
}

describe("connection cache lifecycle", () => {
  test("releaseCachedConnection checkpoints and closes before cache removal", async () => {
    const cache = createConnectionCache({ max: 2 });
    const id = { kind: "account", ownerKey: "owner-a" };
    const handle = mockHandle();
    setCachedConnection(cache, id, handle);

    const released = await releaseCachedConnection(cache, id);
    expect(released).toBe(true);
    expect(handle.events).toEqual(["checkpoint", "close"]);
    expect(getCachedConnection(cache, id)).toBeUndefined();
  });

  test("releaseCachedConnection is a no-op when id is not cached", async () => {
    const cache = createConnectionCache({ max: 2 });
    const released = await releaseCachedConnection(cache, { kind: "account", ownerKey: "missing" });
    expect(released).toBe(false);
  });

  test("LRU eviction still closes handles best-effort", async () => {
    const closed: string[] = [];
    const cache = createConnectionCache({
      max: 1,
      onEvictionCloseError: (error) => {
        throw error;
      },
    });
    const first = mockHandle();
    first.close = async () => {
      first.events.push("close");
      closed.push("first");
    };
    const second = mockHandle();
    setCachedConnection(cache, { kind: "account", ownerKey: "first" }, first);
    setCachedConnection(cache, { kind: "account", ownerKey: "second" }, second);

    await Bun.sleep(0);
    expect(closed).toEqual(["first"]);
  });

  test("explicit release skips duplicate close on cache delete dispose", async () => {
    const cache = createConnectionCache({ max: 2 });
    const id = { kind: "account", ownerKey: "owner-a" };
    const handle = mockHandle();
    setCachedConnection(cache, id, handle);

    await releaseCachedConnection(cache, id);
    expect(handle.events.filter((event) => event === "close")).toHaveLength(1);
  });
});
