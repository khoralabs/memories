import { describe, expect, test } from "bun:test";
import {
  RETRIEVAL_AUTOLINK_EDGE_KIND,
  RETRIEVAL_BOOTSTRAP_NODE_KIND,
  retrievalAutolinkOntology,
} from "@khoralabs/memories-autolink";
import z from "zod";
import { defineOntology } from "../api/ontology";
import { mergeOntologies } from "./merge-ontologies";

describe("mergeOntologies", () => {
  test("layers retrieval kinds over base", () => {
    const base = defineOntology({
      nodeLabels: { fact: z.object({ text: z.string() }) },
      edgeLabels: { relates: z.object({}) },
    });
    const merged = mergeOntologies(base, retrievalAutolinkOntology);
    expect(merged.nodeLabels).toHaveProperty("fact");
    expect(merged.nodeLabels).toHaveProperty(RETRIEVAL_BOOTSTRAP_NODE_KIND);
    expect(merged.edgeLabels).toHaveProperty("relates");
    expect(merged.edgeLabels).toHaveProperty(RETRIEVAL_AUTOLINK_EDGE_KIND);
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
