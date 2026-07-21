import type { LabelPropsSearchFormatter } from "@khoralabs/memories-persistence-core";
import z from "zod";
import { nl, s } from "./format-helpers.ts";

export const referencesEdgeLabelShape = z
  .object({
    context: z
      .string()
      .optional()
      .describe("Why this link exists: citation, background reading, ticket."),
  })
  .describe("Points to supporting material or related memory without implying causality.");

export const affectsEdgeLabelShape = z
  .object({
    impact: z
      .enum(["low", "medium", "high"])
      .optional()
      .describe("How strongly the source influences the target."),
    aspect: z
      .string()
      .optional()
      .describe("What dimension is affected: timeline, cost, morale, scope, etc."),
  })
  .describe("Source changes or constrains the target in practice.");

export const causesEdgeLabelShape = z
  .object({
    mechanism: z.string().optional().describe("Short causal chain or mediating factor."),
  })
  .describe("Source brought about or strongly explains the target.");

export const describesEdgeLabelShape = z
  .object({
    facet: z
      .string()
      .optional()
      .describe("Which part of the target is characterized (role, history, risk)."),
  })
  .describe("Source text or node is primarily about the target.");

export const includesEdgeLabelShape = z
  .object({
    part: z
      .string()
      .optional()
      .describe("Role of the target inside the aggregate: agenda item, attendee, subtask."),
  })
  .describe("Source aggregate or agenda contains the target member.");

export const canonicalRelationEdgeLabelShapes = {
  references: referencesEdgeLabelShape,
  affects: affectsEdgeLabelShape,
  causes: causesEdgeLabelShape,
  describes: describesEdgeLabelShape,
  includes: includesEdgeLabelShape,
} as const;

export const canonicalRelationLabelPropsSearchFormatter: LabelPropsSearchFormatter = (
  kind,
  role,
  props,
) => {
  if (role !== "edge") {
    return "";
  }

  switch (kind) {
    case "references":
      return props.context ? `Reference context: ${s(props.context)}.` : "";
    case "affects":
      return nl([
        props.impact ? `Impact: ${s(props.impact)}.` : "",
        props.aspect ? `Affected aspect: ${s(props.aspect)}.` : "",
      ]);
    case "causes":
      return props.mechanism ? `Causal mechanism: ${s(props.mechanism)}.` : "";
    case "describes":
      return props.facet ? `Describes facet: ${s(props.facet)}.` : "";
    case "includes":
      return props.part ? `Part or role in aggregate: ${s(props.part)}.` : "";
    default:
      return "";
  }
};
