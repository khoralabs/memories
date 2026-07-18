import { describe } from "bun:test";
import { runMemoriesProjectionsContractTests } from "@khoralabs/memories-projections-contract";
import {
  createMemoriesPersistenceAsync,
  openTestMemoriesDatabase,
} from "@khoralabs/memories-sqlite";
import { createSqliteGraphProjectionSource } from "./source";

function openSqliteProjectionContractHandles() {
  try {
    const db = openTestMemoriesDatabase();
    return {
      source: createSqliteGraphProjectionSource(db),
      persistence: createMemoriesPersistenceAsync(db),
    };
  } catch (e) {
    // First open can race: ensureCustomSqlite loads libsqlite before SQLCipher setCustomSQLite.
    const msg = e instanceof Error ? e.message : String(e);
    if (!/SQLite already loaded/i.test(msg)) throw e;
    const db = openTestMemoriesDatabase();
    return {
      source: createSqliteGraphProjectionSource(db),
      persistence: createMemoriesPersistenceAsync(db),
    };
  }
}

describe("sqlite projections contract", () => {
  runMemoriesProjectionsContractTests("sqlite", () => openSqliteProjectionContractHandles());
});
