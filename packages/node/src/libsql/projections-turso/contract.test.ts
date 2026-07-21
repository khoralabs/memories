import { describe } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMemoriesProjectionsContractTests } from "../../testing/index";
import { createLibsqlDatabase, createMemoriesLibsqlPersistence } from "../persistence/index";
import { createTursoGraphProjectionSource } from "./source";

/** Turso-family SQL is compatible with local libSQL; seed via memories-libsql. */
describe("turso projections contract", () => {
  runMemoriesProjectionsContractTests("turso", async () => {
    const dir = mkdtempSync(join(tmpdir(), "memories-proj-turso-"));
    const db = createLibsqlDatabase({ url: `file:${join(dir, "test.db")}` });
    const persistence = await createMemoriesLibsqlPersistence({ db, autoMigrate: true });
    return {
      source: createTursoGraphProjectionSource(db.client),
      persistence,
    };
  });
});
