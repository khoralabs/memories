import { describe, expect, test } from "bun:test";
import type { LabelSchemaMap, OntologyDefinition } from "@khoralabs/memories-node/ontology";

import { deserializeSearchHit, serializeSearchHit } from "./wire";

const ontology: OntologyDefinition<LabelSchemaMap, LabelSchemaMap> = {
  nodeLabels: {},
  edgeLabels: {},
};

describe("memories service client wire", () => {
  test("serializes and deserializes search hits", () => {
    const wire = serializeSearchHit({
      _id: "sm-1",
      memory_id: "mem-1",
      source_key: "src-1",
      score: 0.9,
      memory: { namespace: "ns/a", key: "k1", kind: "node" },
      labels: [{ kind: "memory", props: { features: [] } }],
      graph: { kind: "node" },
    } as never);
    const roundTrip = deserializeSearchHit(wire);
    expect(roundTrip._id).toBe("sm-1");
    expect(roundTrip.memory_id).toBe("mem-1");
    expect(roundTrip.source_key).toBe("src-1");
  });

  test("exports ontology type for remote clients", () => {
    expect(ontology.nodeLabels).toEqual({});
  });

  test("DatabaseMergeRequest includes intentSnapshotId but not contributor", () => {
    const req = {
      database: { kind: "account", ownerKey: "owner" },
      params: { kind: "node", key: "k1", namespace: "ns", labels: [], content: [] },
      intentSnapshotId: "run-1",
    };
    const json = JSON.stringify(req);
    expect(json).toContain("intentSnapshotId");
    expect(json).not.toContain("contributor");
  });

  test("DatabaseDeleteMemoryRequest includes intentSnapshotId but not contributor", () => {
    const req = {
      database: { kind: "account", ownerKey: "owner" },
      namespace: "ns",
      key: "k1",
      intentSnapshotId: "run-2",
    };
    const json = JSON.stringify(req);
    expect(json).toContain("intentSnapshotId");
    expect(json).not.toContain("contributor");
  });

  test("DatabaseSuppressNamespaceRequest includes intentSnapshotId but not contributor", () => {
    const req = {
      database: { kind: "account", ownerKey: "owner" },
      namespace: "ns",
      intentSnapshotId: "run-ns",
    };
    const json = JSON.stringify(req);
    expect(json).toContain("intentSnapshotId");
    expect(json).not.toContain("contributor");
  });

  test("DatabaseSuppressMemoryRequest includes intentSnapshotId but not contributor", () => {
    const req = {
      database: { kind: "account", ownerKey: "owner" },
      namespace: "ns",
      key: "k1",
      intentSnapshotId: "run-3",
    };
    const json = JSON.stringify(req);
    expect(json).toContain("intentSnapshotId");
    expect(json).not.toContain("contributor");
  });
});
