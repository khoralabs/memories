import { describe, expect, test } from "bun:test";
import { defineOntology } from "@khoralabs/memories-ontologies";
import z from "zod";
import {
  type IntegratorPlanWire,
  parseIntegratorPlanWire,
  zIntegratorPlanWire,
} from "./integrator-output.js";
import { integratorWireToMergeSlice } from "./to-merge-slice.js";

describe("MemoryIntegratorPlan schema + merge mapping", () => {
  test("parses nodeLabels as keyed object and edges with keyed payload", () => {
    const ontology = defineOntology({
      nodeLabels: {
        fact: z.object({ subject: z.string(), predicate: z.string(), object: z.string() }),
      },
      edgeLabels: { references: z.object({ context: z.string().optional() }) },
    });
    const parsed = parseIntegratorPlanWire(ontology, {
      nodeLabels: {
        fact: { subject: "a", predicate: "b", object: "c" },
      },
      edges: [
        {
          references: { context: "see also" },
          memory: "neighbor-key",
          direction: "out",
        },
      ],
      properties: { note: 1 },
    });

    expect(parsed.nodeLabels).toEqual({
      fact: { subject: "a", predicate: "b", object: "c" },
    });
    expect(parsed.edges[0]?.memory).toBe("neighbor-key");
    expect(parsed.edges[0]?.references).toEqual({
      context: "see also",
    });
  });

  test("empty nodeLabels object", () => {
    const ontology = defineOntology({
      nodeLabels: { fact: z.object({}) },
      edgeLabels: {},
    });
    const schema = zIntegratorPlanWire(ontology);
    const parsed = schema.parse({ nodeLabels: {}, edges: [] });
    expect(parsed.nodeLabels).toEqual({});
  });

  test("rejects edge row with zero edge kind payloads", () => {
    const ontology = defineOntology({
      nodeLabels: {},
      edgeLabels: { references: z.object({}) },
    });
    const schema = zIntegratorPlanWire(ontology);
    expect(() =>
      schema.parse({
        nodeLabels: {},
        edges: [{ memory: "k", direction: "out" }],
      }),
    ).toThrow();
  });

  test("rejects edge row with two edge kind payloads", () => {
    const ontology = defineOntology({
      nodeLabels: {},
      edgeLabels: {
        references: z.object({}),
        affects: z.object({}),
      },
    });
    const schema = zIntegratorPlanWire(ontology);
    expect(() =>
      schema.parse({
        nodeLabels: {},
        edges: [
          {
            memory: "k",
            direction: "out",
            references: {},
            affects: {},
          },
        ],
      }),
    ).toThrow();
  });

  test("integratorWireToMergeSlice maps object nodeLabels and keyed edge payload", () => {
    const ontology = defineOntology({
      nodeLabels: {
        fact: z.object({ subject: z.string(), predicate: z.string(), object: z.string() }),
      },
      edgeLabels: { references: z.object({}) },
    });
    const slice = integratorWireToMergeSlice(ontology, {
      nodeLabels: { fact: { subject: "x", predicate: "y", object: "z" } },
      edges: [
        {
          references: {},
          memory: "other",
          direction: "in",
        },
      ],
    });
    expect(slice.labels[0]).toEqual({
      kind: "fact",
      props: { subject: "x", predicate: "y", object: "z" },
    });
    expect(slice.edges?.[0]).toMatchObject({
      peer_memory_id: "other",
      direction: "in",
      label: { kind: "references", props: {} },
    });
  });

  test("invalid edge payload fails at wire parse", () => {
    const ontology = defineOntology({
      nodeLabels: {},
      edgeLabels: { references: z.object({ context: z.string().optional() }) },
    });
    const schema = zIntegratorPlanWire(ontology);
    expect(() =>
      schema.parse({
        nodeLabels: {},
        edges: [
          {
            references: "not-an-object",
            memory: "n",
            direction: "out",
          },
        ],
      }),
    ).toThrow();
  });

  test("allowedMemoryKeys enum accepts listed keys and rejects others", () => {
    const ontology = defineOntology({
      nodeLabels: { fact: z.object({}) },
      edgeLabels: { references: z.object({ context: z.string().optional() }) },
    });
    const schema = zIntegratorPlanWire(ontology, {
      allowedMemoryKeys: ["beliefs/s1/b1", "documents/doc-1"],
    });
    const parsed = schema.parse({
      nodeLabels: {},
      edges: [
        {
          memory: "beliefs/s1/b1",
          direction: "out",
          references: { context: "related" },
        },
      ],
    }) as IntegratorPlanWire;
    expect(parsed.edges[0]?.memory).toBe("beliefs/s1/b1");
    expect(() =>
      schema.parse({
        nodeLabels: {},
        edges: [
          {
            memory: "invented_slug",
            direction: "out",
            references: { context: "nope" },
          },
        ],
      }),
    ).toThrow();
  });

  test("empty allowedMemoryKeys forces edges: []", () => {
    const ontology = defineOntology({
      nodeLabels: { fact: z.object({}) },
      edgeLabels: { references: z.object({}) },
    });
    const schema = zIntegratorPlanWire(ontology, { allowedMemoryKeys: [] });
    const parsed = schema.parse({ nodeLabels: {}, edges: [] });
    expect(parsed.edges).toEqual([]);
    expect(() =>
      schema.parse({
        nodeLabels: {},
        edges: [{ memory: "any", direction: "out", references: {} }],
      }),
    ).toThrow();
  });
});
