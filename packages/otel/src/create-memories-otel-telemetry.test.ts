import { describe, expect, test } from "bun:test";
import { createMemoriesOtelTelemetry } from "./create-memories-otel-telemetry.js";

describe("createMemoriesOtelTelemetry", () => {
  test("emits without throwing when no SDK is configured", () => {
    const tel = createMemoriesOtelTelemetry();
    tel.emitOp({
      op: "search",
      ok: true,
      durationMs: 1.5,
      provenanceRootHex: "abc",
      hitCount: 2,
      namespace: "ns",
    });
    tel.emitDatabaseLifecycle({
      operation: "open",
      ok: true,
      durationMs: 10,
      databaseKind: "user",
      databaseOwnerKey: "o1",
    });
    const child = tel.child?.({ "deployment.environment": "test" });
    expect(child).toBeDefined();
    child?.emitOp({
      op: "merge",
      ok: false,
      durationMs: 2,
      provenanceRootHex: "",
      error: "fail",
    });
  });
});
