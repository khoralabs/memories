import { describe, expect, test } from "bun:test";
import { runMemoriesDatabaseBackendContractTests } from "../../testing/index";

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
    () => {
      const url = process.env.TURSO_DATABASE_URL?.trim();
      const authToken = process.env.TURSO_AUTH_TOKEN?.trim();
      if (!url || !authToken) {
        throw new Error("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are required");
      }
      return createTursoServerlessBackend({
        strategy: {
          kind: "turso-serverless",
          url,
          authToken,
        },
      });
    },
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
