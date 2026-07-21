import { describe, expect, test } from "bun:test";

import {
  canonicalizeStoredOntology,
  hashStoredOntology,
  listOntologyLabelKinds,
  type StoredOntologyJsonSchema,
} from "./ontology";

const sampleSchema = (): StoredOntologyJsonSchema => ({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  properties: {
    nodeLabels: {
      type: "object",
      additionalProperties: false,
      properties: {
        fact: {
          type: "object",
          properties: {
            confidence: {
              type: "number",
              description: "Confidence score between 0 and 1",
            },
          },
          required: ["confidence"],
          additionalProperties: false,
        },
        person: {
          type: "object",
          properties: {
            name: { type: "string", description: "Display name" },
          },
          required: ["name"],
          additionalProperties: false,
        },
      },
    },
    edgeLabels: {
      type: "object",
      additionalProperties: false,
      properties: {
        relates_to: {
          type: "object",
          properties: {
            strength: { type: "number", description: "Relationship strength" },
          },
          required: ["strength"],
          additionalProperties: false,
        },
      },
    },
  },
  required: ["nodeLabels", "edgeLabels"],
  additionalProperties: false,
});

function schemaWithNodeKind(kind: string): StoredOntologyJsonSchema {
  return {
    ...sampleSchema(),
    properties: {
      nodeLabels: {
        type: "object",
        additionalProperties: false,
        properties: {
          [kind]: {
            type: "object",
            properties: { text: { type: "string" } },
            required: ["text"],
            additionalProperties: false,
          },
        },
      },
      edgeLabels: sampleSchema().properties.edgeLabels,
    },
  };
}

describe("stored ontology json schema", () => {
  test("sample schema uses registry-level JSON Schema shape", () => {
    const schema = sampleSchema();
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(schema.type).toBe("object");
    expect(schema.required).toEqual(["nodeLabels", "edgeLabels"]);
    expect(schema.properties.nodeLabels.type).toBe("object");
    expect(schema.properties.edgeLabels.type).toBe("object");
  });

  test("preserves field descriptions in per-label schemas", () => {
    const schema = sampleSchema();
    const factSchema = schema.properties.nodeLabels.properties.fact;
    if (factSchema === undefined) {
      throw new Error("expected fact schema");
    }
    const confidence = (factSchema.properties as Record<string, { description?: string }>)
      .confidence;
    expect(confidence?.description).toBe("Confidence score between 0 and 1");
  });

  test("canonicalize is stable regardless of key order", () => {
    const first = sampleSchema();
    const second = JSON.parse(canonicalizeStoredOntology(first)) as StoredOntologyJsonSchema;
    const fact = second.properties.nodeLabels.properties.fact;
    const person = second.properties.nodeLabels.properties.person;
    if (fact === undefined || person === undefined) {
      throw new Error("expected fact and person label schemas");
    }
    second.properties.nodeLabels.properties = {
      person,
      fact,
    };
    expect(canonicalizeStoredOntology(first)).toBe(canonicalizeStoredOntology(second));
  });

  test("descriptions affect hash", () => {
    const base = sampleSchema();
    const described = sampleSchema();
    const factSchema = described.properties.nodeLabels.properties.fact;
    if (factSchema === undefined) {
      throw new Error("expected fact schema");
    }
    const confidence = (factSchema.properties as Record<string, { description?: string }>)
      .confidence;
    if (confidence === undefined) {
      throw new Error("expected confidence schema");
    }
    confidence.description = "Different description";
    expect(hashStoredOntology(base)).not.toBe(hashStoredOntology(described));
  });

  test("listOntologyLabelKinds returns sorted kinds", () => {
    expect(listOntologyLabelKinds(sampleSchema())).toEqual({
      nodeKinds: ["fact", "person"],
      edgeKinds: ["relates_to"],
    });
  });

  test("schemaWithNodeKind helper supports store tests", () => {
    expect(listOntologyLabelKinds(schemaWithNodeKind("belief"))).toEqual({
      nodeKinds: ["belief"],
      edgeKinds: ["relates_to"],
    });
  });
});
