import { describe, expect, test } from "bun:test";
import {
  bindMemoriesTelemetry,
  type MemoriesOpEvent,
  type MemoriesTelemetry,
  type MemoriesTelemetryAttributes,
  noopMemoriesTelemetry,
  runWithOpTelemetrySync,
} from "./index.js";

function recordingTelemetry() {
  const ops: MemoriesOpEvent[] = [];
  const tel: MemoriesTelemetry = {
    emitOp(event) {
      ops.push(event);
    },
    emitDatabaseLifecycle() {},
  };
  return { tel, ops };
}

describe("runWithOpTelemetrySync", () => {
  test("is a no-op without telemetry", () => {
    const result = runWithOpTelemetrySync({
      telemetry: undefined,
      op: "search",
      getProvenanceRootHex: () => "abc",
      fn: () => 42,
    });
    expect(result).toBe(42);
  });

  test("emits success with duration and fields", () => {
    const { tel, ops } = recordingTelemetry();
    const result = runWithOpTelemetrySync({
      telemetry: tel,
      op: "merge",
      namespace: "ns",
      memoryKind: "node",
      memoryKey: "k",
      getProvenanceRootHex: () => "deadbeef",
      successFields: (ids: string[]) => ({ mergedMemoryCount: ids.length }),
      fn: () => ["m1", "m2"],
    });
    expect(result).toEqual(["m1", "m2"]);
    expect(ops).toHaveLength(1);
    expect(ops[0]?.ok).toBe(true);
    expect(ops[0]?.op).toBe("merge");
    expect(ops[0]?.mergedMemoryCount).toBe(2);
    expect(ops[0]?.provenanceRootHex).toBe("deadbeef");
    expect(ops[0]?.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("emits failure and rethrows", () => {
    const { tel, ops } = recordingTelemetry();
    expect(() =>
      runWithOpTelemetrySync({
        telemetry: tel,
        op: "delete",
        getProvenanceRootHex: () => "",
        fn: () => {
          throw new Error("boom");
        },
      }),
    ).toThrow("boom");
    expect(ops).toHaveLength(1);
    expect(ops[0]?.ok).toBe(false);
    expect(ops[0]?.error).toBe("boom");
  });
});

describe("bindMemoriesTelemetry", () => {
  test("merges bound attrs into emits", () => {
    const { tel, ops } = recordingTelemetry();
    const bound = bindMemoriesTelemetry(tel, {
      "memories.database.kind": "user",
      "memories.database.owner_key": "o1",
    });
    bound.emitOp({
      op: "search",
      ok: true,
      durationMs: 1,
      provenanceRootHex: "",
      hitCount: 0,
      attributes: { custom: true },
    });
    expect(ops[0]?.attributes).toEqual({
      "memories.database.kind": "user",
      "memories.database.owner_key": "o1",
      custom: true,
    });
  });

  test("noop child returns noop", () => {
    const child = noopMemoriesTelemetry.child?.({ a: 1 });
    expect(child).toBe(noopMemoriesTelemetry);
  });
});

describe("MemoriesTelemetryAttributes typing", () => {
  test("accepts primitive attrs", () => {
    const attrs: MemoriesTelemetryAttributes = { a: 1, b: "x", c: true };
    expect(attrs.a).toBe(1);
  });
});
