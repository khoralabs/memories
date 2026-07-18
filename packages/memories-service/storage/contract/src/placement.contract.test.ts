import { describe, expect, test } from "bun:test";
import type {
  MemoriesDatabaseBackendStrategy,
  MemoriesDatabasePlacementStore,
} from "@khoralabs/memories-service-storage-core";

export type MemoriesDatabasePlacementStoreContractFactory = () =>
  | MemoriesDatabasePlacementStore
  | Promise<MemoriesDatabasePlacementStore>;

export function runMemoriesDatabasePlacementStoreContractTests(
  name: string,
  create: MemoriesDatabasePlacementStoreContractFactory,
): void {
  describe(`${name} placement store contract`, () => {
    test("get/set default strategy", async () => {
      const store = await create();
      const next: MemoriesDatabaseBackendStrategy = {
        kind: "sqlite",
        dataDir: `/tmp/placement-default-${Date.now()}`,
      };
      await store.setDefaultStrategy(next);
      expect(await store.getDefaultStrategy()).toEqual(next);
    });

    test("override get/set/remove and listOverrides filter", async () => {
      const store = await create();
      const accountId = {
        kind: "account",
        ownerKey: `placement-a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      };
      const orgId = {
        kind: "organization",
        ownerKey: `placement-o-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      };
      const accountStrategy: MemoriesDatabaseBackendStrategy = {
        kind: "turso-serverless",
        url: "libsql://account.example",
      };
      const orgStrategy: MemoriesDatabaseBackendStrategy = {
        kind: "sqlite",
        dataDir: `/tmp/placement-org-${Date.now()}`,
      };

      await store.setStrategy(accountId, accountStrategy);
      await store.setStrategy(orgId, orgStrategy);

      expect(await store.getStrategy(accountId)).toEqual(accountStrategy);
      expect(await store.getStrategy(orgId)).toEqual(orgStrategy);

      const accountOverrides = await store.listOverrides({ kind: "account" });
      expect(accountOverrides).toEqual([{ id: accountId, strategy: accountStrategy }]);

      await store.removeStrategy(accountId);
      expect(await store.getStrategy(accountId)).toBeUndefined();
      expect(await store.listOverrides({ kind: "account" })).toEqual([]);
      expect(await store.listOverrides({ kind: "organization" })).toEqual([
        { id: orgId, strategy: orgStrategy },
      ]);
    });
  });
}
