import { describe } from "bun:test";
import { runMemoriesPersistenceContractTests } from "../../testing/index";
import { openLibsqlTestPersistence } from "./test-harness";

describe("libsql contract", () => {
  runMemoriesPersistenceContractTests("libsql", () => openLibsqlTestPersistence());
});
