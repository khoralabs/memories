import { describe, expect, test } from "bun:test";
import { MemoriesClient } from "@khoralabs/memories-node";
import { defineOntology } from "@khoralabs/memories-node/ontology";
import {
  createMemoriesPersistence,
  openTestMemoriesDatabase,
} from "@khoralabs/memories-node/sqlite";
import z from "zod";
import { applyIntegratorPlanToMerge } from "./apply-plan.js";

describe("applyIntegratorPlanToMerge", () => {
  test("merges plan, keeps edges to existing peers only", async () => {
    const ontology = defineOntology({
      nodeLabels: { fact: z.object({ subject: z.string() }) },
      edgeLabels: { references: z.object({}) },
    });
    const client = new MemoriesClient(
      createMemoriesPersistence(openTestMemoriesDatabase()),
      ontology,
    );
    const base = { client, namespace: "ns", content: "hello" };
    await applyIntegratorPlanToMerge({
      ...base,
      key: "peer",
      plan: { nodeLabels: {}, edges: [] },
    });
    const plan = await applyIntegratorPlanToMerge({
      ...base,
      key: "m1",
      plan: {
        nodeLabels: { fact: { subject: "s" } },
        edges: [
          { references: {}, memory: "peer", direction: "out" },
          { references: {}, memory: "missing", direction: "out" },
        ],
      },
    });
    expect(plan.nodeLabels).toEqual({ fact: { subject: "s" } });
    expect(client.persistence.findMemoryIdByKey("ns", "m1")).toBeDefined();
    expect(client.persistence.listIncidentGraphEdges?.("ns", "m1")).toHaveLength(1);
  });
});
