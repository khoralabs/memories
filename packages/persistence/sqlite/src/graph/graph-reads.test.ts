import { describe, expect, test } from "bun:test";
import { mergeMemory } from "@khoralabs/memories-core";
import { ids } from "@khoralabs/memories-persistence-core";
import {
  createMemoriesPersistence,
  listMemoryNamespaces,
  openTestMemoriesDatabase,
} from "../index";

describe("MemoriesGraphIndex per-entity reads", () => {
  test("loadGraphNode matches split loaders; loadGraphEdge; listIncidentGraphEdges", () => {
    const db = openTestMemoriesDatabase();
    const persistence = createMemoriesPersistence(db);
    mergeMemory(
      { persistence },
      {
        key: "a",
        namespace: "ns",
        content: [{ key: "b", text: "a" }],
        labels: [{ kind: "topic", props: { t: 1 } }],
        edges: [],
        properties: { nodeProp: true },
      },
    );
    mergeMemory(
      { persistence },
      {
        key: "b",
        namespace: "ns",
        content: [{ key: "b", text: "b" }],
        labels: [],
        edges: [
          {
            peer_memory_id: ids.memory("ns", "a"),
            direction: "out",
            label: { kind: "rel", props: {} },
          },
        ],
      },
    );

    const labelsA = persistence.loadNodeLabelsForMemory("ns", "a");
    expect(labelsA.map((l) => l.kind)).toContain("topic");

    const propsA = persistence.loadNodePropertiesForMemory("ns", "a");
    expect(propsA).toEqual({ nodeProp: true });

    const gnA = persistence.loadGraphNode("ns", "a");
    expect(gnA).not.toBeNull();
    expect(gnA?.namespace).toBe("ns");
    expect(gnA?.memoryKey).toBe("a");
    expect(gnA?.nodeId).toBe(ids.node("ns", "a"));
    expect(gnA?.labels.map((l) => l.kind)).toContain("topic");
    expect(gnA?.properties).toEqual({ nodeProp: true });

    expect(persistence.loadNodePropertiesForMemory("ns", "unknown")).toBeNull();
    expect(persistence.loadGraphNode("ns", "unknown")).toBeNull();

    expect(listMemoryNamespaces(db)).toEqual(["ns"]);

    const edges = persistence.loadGraphEdgesForNamespace("ns");
    expect(edges).toHaveLength(1);
    const firstEdge = edges[0];
    if (!firstEdge) throw new Error("expected one edge");
    const edgeId = firstEdge.edgeId;
    expect(firstEdge.properties).toBeTruthy();
    expect((firstEdge.properties as { directed?: boolean }).directed).toBe(true);

    const one = persistence.loadGraphEdge("ns", edgeId);
    expect(one?.edgeId).toBe(edgeId);
    expect(one?.fromKey).toBe("b");
    expect(one?.toKey).toBe("a");
    expect(one?.labels.some((l) => l.kind === "rel")).toBe(true);

    expect(persistence.loadGraphEdge("ns", "no_such_edge")).toBeNull();
    expect(persistence.loadGraphEdge("other", edgeId)).toBeNull();

    const inc = persistence.listIncidentGraphEdges("ns", "a");
    expect(inc).toHaveLength(1);
    expect(inc[0]?.edgeId).toBe(edgeId);
  });
});
