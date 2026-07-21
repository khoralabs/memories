import { runMemoriesPersistenceContractTests } from "../../testing/index";
import { createMemoriesPersistenceAsync, openTestMemoriesDatabase } from "./index";

function openSqliteContractPersistence() {
  try {
    return createMemoriesPersistenceAsync(openTestMemoriesDatabase());
  } catch (e) {
    // First open can race: ensureCustomSqlite loads libsqlite before SQLCipher setCustomSQLite.
    const msg = e instanceof Error ? e.message : String(e);
    if (!/SQLite already loaded/i.test(msg)) throw e;
    return createMemoriesPersistenceAsync(openTestMemoriesDatabase());
  }
}

runMemoriesPersistenceContractTests("sqlite", () => openSqliteContractPersistence());
