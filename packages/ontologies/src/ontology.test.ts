import { describe, expect, test } from "bun:test";
import z from "zod";
import {
  defineOntology,
  edgeLabelPropsSchema,
  nodeLabelPropsSchema,
  propsSchemaToJson,
} from "./ontology";

function validateProps(
  schema: { "~standard": { validate: (v: unknown) => unknown } },
  value: unknown,
) {
  const result = schema["~standard"].validate(value);
  if (result instanceof Promise) {
    throw new Error("expected sync validation");
  }
  const r = result as { value?: unknown; issues?: { message: string }[] };
  if (r.issues?.length) {
    throw new Error(r.issues.map((i) => i.message).join("; "));
  }
  return r.value;
}

describe("ontology narrow helpers", () => {
  const ontology = defineOntology({
    nodeLabels: {
      topic: z.object({ weight: z.number().optional() }),
      pinned: z.object({}),
    },
    edgeLabels: {
      relates_to: z.object({ strength: z.number() }),
    },
  });

  test("nodeLabelPropsSchema returns schema for known kind", () => {
    const s = nodeLabelPropsSchema(ontology, "topic");
    expect(s).toBeDefined();
    if (s === undefined) throw new Error("expected schema");
    expect(validateProps(s, { weight: 0.5 })).toEqual({ weight: 0.5 });
  });

  test("nodeLabelPropsSchema returns undefined for unknown kind", () => {
    expect(nodeLabelPropsSchema(ontology, "missing")).toBeUndefined();
  });

  test("edgeLabelPropsSchema returns schema for known kind", () => {
    const s = edgeLabelPropsSchema(ontology, "relates_to");
    expect(s).toBeDefined();
    if (s === undefined) throw new Error("expected schema");
    expect(validateProps(s, { strength: 0.5 })).toEqual({ strength: 0.5 });
  });

  test("propsSchemaToJson produces an object", () => {
    const j = propsSchemaToJson(z.object({ a: z.number() }));
    expect(j).toBeDefined();
    expect(typeof j).toBe("object");
  });
});
