import { describe } from "bun:test";
import { runMemoriesProjectionsContractTests } from "../../testing/index";
import { createMemoriesPersistenceAsync, openTestMemoriesDatabase } from "../persistence/index";
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
