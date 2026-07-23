import { describe, expect, test } from "bun:test";
import type { StoredOntologyJsonSchema } from "../storage/core/index";
import { ontologyFromMergeParams } from "./persistence-handlers";
import { labelSchemaFromStoredPropsJson } from "./stored-ontology-label-schema";

const linkedOntology = (): StoredOntologyJsonSchema => ({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  properties: {
    nodeLabels: {
      type: "object",
      additionalProperties: false,
      properties: {
        person: {
          type: "object",
          properties: {
            name: { type: "string" },
          },
          required: ["name"],
          additionalProperties: false,
        },
      },
    },
    edgeLabels: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
  },
  required: ["nodeLabels", "edgeLabels"],
  additionalProperties: false,
});

function validateSync(
  schema: { "~standard": { validate: (v: unknown) => unknown } },
  value: unknown,
): { ok: true; value: unknown } | { ok: false; message: string } {
  const result = schema["~standard"].validate(value);
  if (result instanceof Promise) throw new Error("expected sync validation");
  const r = result as { value?: unknown; issues?: { message: string }[] };
  if (r.issues?.length) {
    return { ok: false, message: r.issues.map((i) => i.message).join("; ") };
  }
  return { ok: true, value: r.value };
}

describe("labelSchemaFromStoredPropsJson", () => {
  test("accepts valid props and rejects missing required fields", () => {
    const schema = labelSchemaFromStoredPropsJson({
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
      additionalProperties: false,
    });
    expect(validateSync(schema, { name: "Ada" }).ok).toBe(true);
    expect(validateSync(schema, {}).ok).toBe(false);
  });
});

describe("ontologyFromMergeParams", () => {
  test("uses linked schemas for known kinds and permissive for unknown", () => {
    const ontology = ontologyFromMergeParams(
      {
        kind: "node",
        labels: [
          { kind: "person", props: { name: "Ada" } },
          { kind: "custom", props: { anything: true } },
        ],
      },
      linkedOntology(),
    );

    const person = ontology.nodeLabels.person;
    const custom = ontology.nodeLabels.custom;
    expect(person).toBeDefined();
    expect(custom).toBeDefined();
    if (person === undefined || custom === undefined) return;

    expect(validateSync(person, { name: "Ada" }).ok).toBe(true);
    expect(validateSync(person, {}).ok).toBe(false);
    // Unknown kind falls back to permissive object schema.
    expect(validateSync(custom, { anything: true }).ok).toBe(true);
  });

  test("all permissive when no linked ontology", () => {
    const ontology = ontologyFromMergeParams({
      kind: "node",
      labels: [{ kind: "person", props: {} }],
    });
    const person = ontology.nodeLabels.person;
    expect(person).toBeDefined();
    if (person === undefined) return;
    expect(validateSync(person, {}).ok).toBe(true);
  });
});
