import { describe, expect, test } from "bun:test";
import {
  type MemoriesDatabaseBackend,
  type MemoriesDatabaseBackendResolver,
  UnsupportedStorageFeatureError,
  unsupportedStorageFeature,
} from "./index";
import { createMemoriesDatabaseService } from "./service";

describe("MemoriesDatabaseService snapshot", () => {
  test("routes snapshot to the resolved backend", async () => {
    const id = { kind: "account", ownerKey: "owner-a" };
    let seenSnapshotId: typeof id | undefined;
    const backend: MemoriesDatabaseBackend = {
      strategy: { kind: "sqlite", dataDir: "/tmp" },
      async open() {
        throw new Error("open not used");
      },
      async exists() {
        return true;
      },
      async list() {
        return [id];
      },
      async delete() {},
      async checkpoint() {},
      async snapshot(snapshotId) {
        seenSnapshotId = snapshotId;
        return unsupportedStorageFeature("snapshot", "sqlite");
      },
      async close() {},
    };
    const resolver: MemoriesDatabaseBackendResolver = {
      async resolve() {
        return backend;
      },
      async list() {
        return [id];
      },
    };

    const service = createMemoriesDatabaseService({ resolver });

    await expect(service.snapshot(id)).rejects.toThrow(UnsupportedStorageFeatureError);
    expect(seenSnapshotId).toEqual(id);
  });
});
