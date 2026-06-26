import { describe, expect, test } from "bun:test";
import z from "zod";
import { mergeOntologies } from "./merge-ontologies";
import { defineOntology } from "./ontology";

describe("mergeOntologies", () => {
  test("layers retrieval kinds over base", () => {
    const base = defineOntology({
      nodeLabels: { fact: z.object({ text: z.string() }) },
      edgeLabels: { relates: z.object({}) },
    });
    const retrieval = defineOntology({
      nodeLabels: { retrieval_bootstrap: z.object({ query: z.string() }) },
      edgeLabels: { retrieval_autolink: z.object({ score: z.number() }) },
    });
    const merged = mergeOntologies(base, retrieval);
    expect(merged.nodeLabels).toHaveProperty("fact");
    expect(merged.nodeLabels).toHaveProperty("retrieval_bootstrap");
    expect(merged.edgeLabels).toHaveProperty("relates");
    expect(merged.edgeLabels).toHaveProperty("retrieval_autolink");
  });

  test("merges three layers; last key wins on collision", () => {
    const a = defineOntology({
      nodeLabels: { x: z.object({ a: z.number() }) },
      edgeLabels: {},
    });
    const b = defineOntology({
      nodeLabels: { y: z.object({ b: z.string() }) },
      edgeLabels: {},
    });
    const c = defineOntology({
      nodeLabels: {
        x: z.object({ c: z.boolean() }),
      },
      edgeLabels: {},
    });
    const merged = mergeOntologies(a, b, c);
    expect(merged.nodeLabels).toHaveProperty("y");
    // c's `x` overwrites a's `x`
    const xSchema = merged.nodeLabels.x;
    const ok = xSchema["~standard"].validate({ c: true });
    const bad = xSchema["~standard"].validate({ a: 1 });
    expect(ok).toMatchObject({ value: { c: true } });
    expect(bad).toHaveProperty("issues");
  });
});
