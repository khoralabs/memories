import type { LabelPropsSearchFormatter } from "@khoralabs/memories-core";
import z from "zod";
import { nl, s } from "./format-helpers";

export const preferenceNodeLabelShape = z
  .object({
    topic: z
      .string()
      .describe("What the preference is about (stack, vendor, workflow, food, etc.)."),
    stance: z
      .enum(["likes", "dislikes", "neutral", "prefers_when"])
      .describe("Direction of the preference."),
    detail: z.string().optional().describe("One concrete reason or constraint (keep short)."),
  })
  .describe("User taste, default choice, or thing to avoid.");

export const canonicalPreferenceNodeLabelShapes = {
  preference: preferenceNodeLabelShape,
} as const;

export const canonicalPreferenceLabelPropsSearchFormatter: LabelPropsSearchFormatter = (
  kind,
  role,
  props,
) => {
  if (role !== "node" || kind !== "preference") {
    return "";
  }

  return nl([
    `Preference on ${s(props.topic)}: ${s(props.stance)}.`,
    props.detail ? `Detail: ${s(props.detail)}.` : "",
  ]);
};
