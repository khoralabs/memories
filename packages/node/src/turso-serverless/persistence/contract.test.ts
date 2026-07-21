import { describe, expect, test } from "bun:test";
import { runMemoriesPersistenceContractTests } from "../../testing/index";
import { hasTursoIntegrationEnv, openTursoTestPersistence } from "./test-harness";

const integration = hasTursoIntegrationEnv();

describe.skipIf(!integration)("turso contract", () => {
  runMemoriesPersistenceContractTests("turso-serverless", () => openTursoTestPersistence());
});

describe("integration env gate", () => {
  test("skips when credentials absent", () => {
    if (!integration) {
      expect(hasTursoIntegrationEnv()).toBe(false);
    }
  });
});
