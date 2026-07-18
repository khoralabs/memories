import { describe } from "bun:test";
import { runMemoriesPersistenceContractTests } from "@khoralabs/memories-persistence-contract";
import { openLibsqlTestPersistence } from "./test-harness";

describe("libsql contract", () => {
  runMemoriesPersistenceContractTests("libsql", () => openLibsqlTestPersistence());
});
