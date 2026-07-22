import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MemoriesPersistenceAsync } from "../../../persistence/core/persistence";
import { createMemoriesLibsqlPersistence } from "./persistence";

/**
 * Open a persistence handle on a unique temp `file:` database (runs migrations).
 *
 * Prefer this over `file::memory:` / `:memory:` — interactive transactions on
 * private in-memory URLs do not share the migrated schema with the outer client.
 */
export async function openLibsqlTestPersistence(): Promise<MemoriesPersistenceAsync> {
  const dir = mkdtempSync(join(tmpdir(), "memories-libsql-"));
  return createMemoriesLibsqlPersistence({
    url: `file:${join(dir, "test.db")}`,
    autoMigrate: true,
  });
}
