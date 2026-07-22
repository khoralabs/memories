import z from "zod";
import type { LabelPropsSearchFormatter } from "../label-props-search.ts";
import { nl, s } from "./format-helpers.ts";

export const factNodeLabelShape = z
  .object({
    subject: z.string().describe("Entity the fact is about (noun phrase)."),
    predicate: z.string().describe("Relationship or attribute (short verb phrase)."),
    object: z.string().describe("Value or other entity (noun phrase)."),
    source: z.string().optional().describe("Where this was learned: doc, person, ticket id, etc."),
  })
  .describe("Atomic subject-predicate-object statement treated as ground truth here.");

export const observationNodeLabelShape = z
  .object({
    summary: z.string().describe("What was noticed, past tense, one or two sentences max."),
    confidence: z
      .enum(["low", "medium", "high"])
      .optional()
      .describe("How sure the user or system is."),
    observedAt: z
      .string()
      .optional()
      .describe("ISO 8601 when the observation was made or recorded."),
  })
  .describe("Perceived state of the world; may be revised later.");

export const beliefNodeLabelShape = z
  .object({
    claim: z.string().describe("What is believed to be true (full sentence)."),
    certainty: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe("0 = hunch, 1 = would bet on it; omit if unknown."),
    basis: z
      .string()
      .optional()
      .describe("Why this belief exists: inference, hearsay, measurement."),
  })
  .describe("Hypothesis or working assumption, not yet promoted to fact.");

export const canonicalKnowledgeNodeLabelShapes = {
  fact: factNodeLabelShape,
  observation: observationNodeLabelShape,
  belief: beliefNodeLabelShape,
} as const;

export const canonicalKnowledgeLabelPropsSearchFormatter: LabelPropsSearchFormatter = (
  kind,
  role,
  props,
) => {
  if (role !== "node") {
    return "";
  }

  switch (kind) {
    case "fact":
      return nl([
        `Fact: ${s(props.subject)} ${s(props.predicate)} ${s(props.object)}.`,
        props.source ? `Source: ${s(props.source)}.` : "",
      ]);
    case "observation":
      return nl([
        `Observation: ${s(props.summary)}`,
        props.confidence ? `Confidence: ${s(props.confidence)}.` : "",
        props.observedAt ? `Observed at: ${s(props.observedAt)}.` : "",
      ]);
    case "belief":
      return nl([
        `Belief: ${s(props.claim)}`,
        props.certainty !== undefined ? `Certainty: ${s(props.certainty)}.` : "",
        props.basis ? `Basis: ${s(props.basis)}.` : "",
      ]);
    default:
      return "";
  }
};
