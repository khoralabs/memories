import { describe } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLibsqlDatabase, createMemoriesLibsqlPersistence } from "@khoralabs/memories-libsql";
import { runMemoriesProjectionsContractTests } from "@khoralabs/memories-projections-contract";
import { createLibsqlGraphProjectionSource } from "./source";

describe("libsql projections contract", () => {
  runMemoriesProjectionsContractTests("libsql", async () => {
    const dir = mkdtempSync(join(tmpdir(), "memories-proj-libsql-"));
    const db = createLibsqlDatabase({ url: `file:${join(dir, "test.db")}` });
    const persistence = await createMemoriesLibsqlPersistence({ db, autoMigrate: true });
    return {
      source: createLibsqlGraphProjectionSource(db.client),
      persistence,
    };
  });
});
