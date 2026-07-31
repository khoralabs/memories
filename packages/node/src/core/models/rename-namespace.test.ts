import { describe, expect, test } from "bun:test";
import { canonicalOntology } from "../../ontology/canonical.ts";
import { ids, NamespaceConstraintError } from "../../persistence/core";
import { assertRenameRespectsMaxNamespaces } from "../../persistence/core/models/rename-namespace-plan";
import {
  createMemoriesPersistence,
  openTestMemoriesDatabase,
} from "../../persistence/sqlite/persistence/index";
import { MemoriesClient } from "../api/client";

function openClient() {
  const db = openTestMemoriesDatabase();
  const persistence = createMemoriesPersistence(db);
  const client = new MemoriesClient(persistence, canonicalOntology);
  return { db, persistence, client };
}

describe("renameNamespace", () => {
  test(
    "rematerializes findMemoryIdByKey and preserves metadata alias",
    () => {
      const { persistence, client } = openClient();
      client.mergeMemory({
        key: "k1",
        namespace: "old/path",
        content: [{ key: "text", text: "hello" }],
        labels: [],
      });
      const oldId = persistence.findMemoryIdByKey("old/path", "k1");
      expect(oldId).toBe(ids.memory("old/path", "k1"));

      persistence.withTransaction(() => {
        persistence.upsertNamespaceMetadata(
          { now: Date.now() },
          { namespace: "old/path", alias: "Inbox", description: "d" },
        );
      });

      const result = client.renameNamespace({ from: "old/path", to: "new/path" });
      expect(result.renamedMemories).toBe(1);
      expect(persistence.findMemoryIdByKey("old/path", "k1")).toBeUndefined();
      expect(persistence.findMemoryIdByKey("new/path", "k1")).toBe(ids.memory("new/path", "k1"));
      expect(persistence.getNamespaceMetadata("new/path")).toEqual({
        namespace: "new/path",
        alias: "Inbox",
        description: "d",
      });
      expect(persistence.getNamespaceMetadata("old/path")).toBeUndefined();

      const head = persistence.getProvenanceHeadRootHex();
      expect(head).toBeDefined();
    },
    { timeout: 30_000 },
  );
  test("recursive renames descendants", () => {
    const { persistence, client } = openClient();
    client.mergeMemory({
      key: "root",
      namespace: "team",
      content: [{ key: "text", text: "r" }],
      labels: [],
    });
    client.mergeMemory({
      key: "child",
      namespace: "team/project",
      content: [{ key: "text", text: "c" }],
      labels: [],
    });

    client.renameNamespace({ from: "team", to: "org" });
    expect(persistence.findMemoryIdByKey("team", "root")).toBeUndefined();
    expect(persistence.findMemoryIdByKey("org", "root")).toBeDefined();
    expect(persistence.findMemoryIdByKey("org/project", "child")).toBeDefined();
  });

  test("collision fails", () => {
    const { client } = openClient();
    client.mergeMemory({
      key: "same",
      namespace: "a",
      content: [{ key: "text", text: "1" }],
      labels: [],
    });
    client.mergeMemory({
      key: "same",
      namespace: "b",
      content: [{ key: "text", text: "2" }],
      labels: [],
    });
    expect(() => client.renameNamespace({ from: "a", to: "b" })).toThrow(/collision/);
  });

  test("cross-namespace edge to untouched peer survives", () => {
    const { persistence, client } = openClient();
    client.mergeMemory({
      key: "n1",
      namespace: "move",
      content: [{ key: "text", text: "n1" }],
      labels: [],
    });
    const peerId = (() => {
      client.mergeMemory({
        key: "peer",
        namespace: "stay",
        content: [{ key: "text", text: "peer" }],
        labels: [],
      });
      const id = persistence.findMemoryIdByKey("stay", "peer");
      expect(id).toBeDefined();
      if (id === undefined) throw new Error("expected peer memory id");
      return id;
    })();

    client.mergeMemory({
      key: "n1",
      namespace: "move",
      content: [{ key: "text", text: "n1" }],
      labels: [],
      edges: [
        {
          direction: "out",
          peer_memory_id: peerId,
          label: { kind: "references", props: {} },
        },
      ],
    });

    client.renameNamespace({ from: "move", to: "moved" });
    expect(persistence.findMemoryIdByKey("moved", "n1")).toBeDefined();
    expect(persistence.findMemoryIdByKey("stay", "peer")).toBe(peerId);
    const movedNodeId = ids.node("moved", "n1");
    const neighbors = persistence.listNeighborMemoriesForNode(
      { now: Date.now() },
      "moved",
      movedNodeId,
    );
    expect(neighbors.some((n) => n.namespace === "stay" && n.key === "peer")).toBe(true);
  });

  test("depth-invalid to rejected", () => {
    const { client } = openClient();
    client.mergeMemory({
      key: "k",
      namespace: "a",
      content: [{ key: "text", text: "x" }],
      labels: [],
    });
    expect(() =>
      client.renameNamespace({
        from: "a",
        to: "a/b/c/d/e/f/g",
      }),
    ).toThrow();
  });

  test("assertRenameRespectsMaxNamespaces for net-new path", () => {
    expect(() =>
      assertRenameRespectsMaxNamespaces(
        ["a"],
        new Map([
          ["a", "b"],
          ["x", "y"],
        ]),
        1,
      ),
    ).toThrow(NamespaceConstraintError);
    // pure rewrite a→b with cap 1: remove a then add b → ok
    expect(() => assertRenameRespectsMaxNamespaces(["a"], new Map([["a", "b"]]), 1)).not.toThrow();
  });
});
