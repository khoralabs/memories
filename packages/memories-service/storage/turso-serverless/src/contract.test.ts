import { describe, expect, test } from "bun:test";
import { runMemoriesDatabaseBackendContractTests } from "@khoralabs/memories-service-storage-contract";

import { createTursoServerlessBackend } from "./turso-serverless-backend";

function hasTursoIntegrationEnv(): boolean {
  const url = process.env.TURSO_DATABASE_URL?.trim();
  const token = process.env.TURSO_AUTH_TOKEN?.trim();
  return Boolean(url && token);
}

const integration = hasTursoIntegrationEnv();

describe.skipIf(!integration)("turso-serverless live backend", () => {
  runMemoriesDatabaseBackendContractTests(
    "turso-serverless",
    () =>
      createTursoServerlessBackend({
        strategy: {
          kind: "turso-serverless",
          url: process.env.TURSO_DATABASE_URL?.trim(),
          authToken: process.env.TURSO_AUTH_TOKEN?.trim(),
        },
      }),
    {
      canEnumerate: false,
      supportsCheckpoint: true,
      supportsSnapshot: false,
      requiresSqliteHandle: false,
      deleteClearsExistence: false,
    },
  );
});

describe("integration env gate", () => {
  test("skips when credentials absent", () => {
    if (!integration) {
      expect(hasTursoIntegrationEnv()).toBe(false);
    }
  });
});
