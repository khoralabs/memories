import { describe, expect, test } from "bun:test";
import type { LabelSchemaMap, OntologyDefinition } from "@khoralabs/memories-core";

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
});
