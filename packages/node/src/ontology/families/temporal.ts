import z from "zod";
import type { LabelPropsSearchFormatter } from "../label-props-search.ts";
import { nl, s } from "./format-helpers.ts";

export const eventNodeLabelShape = z
  .object({
    summary: z
      .string()
      .optional()
      .describe(
        "Human-readable summary if distinct from surrounding memory text. Keep it short and concise.",
      ),
    startsAt: z.string().optional().describe("Start time in ISO 8601 (UTC or with offset)."),
    endsAt: z.string().optional().describe("End time in ISO 8601 when the event has a clear end."),
    status: z
      .enum(["planned", "completed", "cancelled", "unknown"])
      .optional()
      .describe("Whether this is past, future, or uncertain."),
  })
  .describe("Something that happened or will happen at a time.");

export const temporalNodeLabelShape = z
  .object({
    label: z.string().describe("Human window: e.g. Q1 2025, sprint42, last Tuesday."),
    anchor: z
      .string()
      .optional()
      .describe("ISO 8601 instant or date if the window pins to a single point."),
    grain: z
      .enum(["instant", "day", "week", "month", "quarter", "year", "range", "fuzzy"])
      .optional()
      .describe("How precise the time reference is."),
  })
  .describe("Named or fuzzy time bucket for ordering and recall.");

export const beforeEdgeLabelShape = z
  .object({
    orderingConfidence: z
      .enum(["exact", "approximate", "inferred"])
      .optional()
      .describe("How reliable the ordering is."),
  })
  .describe("Source event or time precedes the target.");

export const afterEdgeLabelShape = z
  .object({
    orderingConfidence: z
      .enum(["exact", "approximate", "inferred"])
      .optional()
      .describe("How reliable the ordering is."),
  })
  .describe("Source event or time follows the target.");

export const duringEdgeLabelShape = z
  .object({
    overlap: z
      .enum(["full", "partial", "unknown"])
      .optional()
      .describe("Whether the whole source fits inside the target window."),
  })
  .describe("Source occurs inside the target interval or container event.");

export const canonicalTemporalNodeLabelShapes = {
  event: eventNodeLabelShape,
  temporal: temporalNodeLabelShape,
} as const;

export const canonicalTemporalEdgeLabelShapes = {
  before: beforeEdgeLabelShape,
  after: afterEdgeLabelShape,
  during: duringEdgeLabelShape,
} as const;

export const canonicalTemporalLabelPropsSearchFormatter: LabelPropsSearchFormatter = (
  kind,
  role,
  props,
) => {
  if (role === "node") {
    switch (kind) {
      case "event":
        return nl([
          props.title ? `Event: ${s(props.title)}.` : "Event.",
          props.startsAt ? `Starts: ${s(props.startsAt)}.` : "",
          props.endsAt ? `Ends: ${s(props.endsAt)}.` : "",
          props.status ? `Status: ${s(props.status)}.` : "",
        ]);
      case "temporal":
        return nl([
          `Time window: ${s(props.label)}.`,
          props.anchor ? `Anchor: ${s(props.anchor)}.` : "",
          props.grain ? `Precision: ${s(props.grain)}.` : "",
        ]);
      default:
        return "";
    }
  }

  switch (kind) {
    case "before":
    case "after":
      return props.orderingConfidence
        ? `Temporal ordering confidence: ${s(props.orderingConfidence)}.`
        : "";
    case "during":
      return props.overlap ? `Time overlap: ${s(props.overlap)}.` : "";
    default:
      return "";
  }
};
