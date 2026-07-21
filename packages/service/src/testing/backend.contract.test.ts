import { describe, expect, test } from "bun:test";
import type { MemoriesDatabaseBackend, MemoriesDatabaseId } from "../storage-core/index";
import { databaseKey, UnsupportedStorageFeatureError } from "../storage-core/index";

export type MemoriesDatabaseBackendContractFactory = () =>
  | MemoriesDatabaseBackend
  | Promise<MemoriesDatabaseBackend>;

export type MemoriesDatabaseBackendContractOptions = {
  /** When true, `list()` includes opened databases. When false, `list()` is always `[]`. */
  canEnumerate: boolean;
  /** When true, `checkpoint(id)` must not throw (no-op is allowed). */
  supportsCheckpoint: boolean;
  /** When false, `snapshot(id)` must throw `UnsupportedStorageFeatureError`. */
  supportsSnapshot: boolean;
  /** When true, opened handles must expose `sqlite`. */
  requiresSqliteHandle: boolean;
  /**
   * When true, `delete(id)` makes `exists(id)` false.
   * Remote backends that keep schema metadata may set this false.
   */
  deleteClearsExistence: boolean;
};

function uniqueId(prefix: string): MemoriesDatabaseId {
  return {
    kind: "account",
    ownerKey: `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
  };
}

function idKeys(ids: readonly MemoriesDatabaseId[]): string[] {
  return ids.map(databaseKey).sort();
}

export function runMemoriesDatabaseBackendContractTests(
  name: string,
  create: MemoriesDatabaseBackendContractFactory,
  options: MemoriesDatabaseBackendContractOptions,
): void {
  describe(`${name} database backend contract`, () => {
    test("open → exists; close; reopen; delete", async () => {
      const backend = await create();
      const id = uniqueId("backend-lifecycle");

      expect(await backend.exists(id)).toBe(false);
      const opened = await backend.open(id);
      expect(opened.persistence).toBeDefined();
      if (options.requiresSqliteHandle) {
        expect(opened.sqlite).toBeDefined();
      } else {
        expect(opened.sqlite).toBeUndefined();
      }
      expect(await backend.exists(id)).toBe(true);

      await backend.close(id);
      expect(await backend.exists(id)).toBe(true);

      const reopened = await backend.open(id);
      expect(reopened.persistence).toBeDefined();
      await reopened.close();

      await backend.delete(id);
      if (options.deleteClearsExistence) {
        expect(await backend.exists(id)).toBe(false);
      }
    });

    test("handle close is idempotent", async () => {
      const backend = await create();
      const id = uniqueId("backend-idempotent");
      const handle = await backend.open(id);
      await handle.close();
      await handle.close();
      await backend.delete(id);
    });

    test("checkpoint does not throw", async () => {
      const backend = await create();
      if (!options.supportsCheckpoint) return;
      const id = uniqueId("backend-checkpoint");
      await backend.open(id);
      await expect(backend.checkpoint(id)).resolves.toBeUndefined();
      await backend.delete(id);
    });

    test("snapshot unsupported throws UnsupportedStorageFeatureError", async () => {
      const backend = await create();
      if (options.supportsSnapshot) return;
      const id = uniqueId("backend-snapshot");
      await expect(backend.snapshot(id)).rejects.toBeInstanceOf(UnsupportedStorageFeatureError);
    });

    test("list enumerates or returns empty per backend capability", async () => {
      const backend = await create();
      const id = uniqueId("backend-list");

      if (!options.canEnumerate) {
        expect(await backend.list()).toEqual([]);
        await backend.open(id);
        expect(await backend.list()).toEqual([]);
        await backend.delete(id);
        return;
      }

      expect(idKeys(await backend.list({ kind: "account" }))).not.toContain(databaseKey(id));
      await backend.open(id);
      const listed = await backend.list({ kind: "account" });
      expect(idKeys(listed)).toContain(databaseKey(id));
      await backend.delete(id);
      expect(idKeys(await backend.list({ kind: "account" }))).not.toContain(databaseKey(id));
    });
  });
}
