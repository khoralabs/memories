import z from "zod";
import type { LabelPropsSearchFormatter } from "../label-props-search.ts";
import { nl, s } from "./format-helpers.ts";

export const personNodeLabelShape = z
  .object({
    name: z.string().describe("Primary name or handle as the user refers to them."),
    role: z
      .string()
      .optional()
      .describe("Job title, relationship (e.g. manager, sibling), or capacity in this context."),
    organization: z.string().optional().describe("Employer, team, or affiliation if known."),
    timezone: z
      .string()
      .optional()
      .describe("IANA tz id (e.g. America/New_York) when scheduling matters."),
  })
  .describe("A human or agent the user interacts with.");

export const placeNodeLabelShape = z
  .object({
    name: z.string().describe("Short label: building, city, or virtual space."),
    kind: z
      .enum(["physical", "online", "region", "other"])
      .optional()
      .describe("How this place is encountered."),
    country: z.string().optional().describe("ISO3166-1 alpha-2 or country name when relevant."),
  })
  .describe("Somewhere work or life happens: office, city, URL-backed venue.");

export const canonicalEntityNodeLabelShapes = {
  person: personNodeLabelShape,
  place: placeNodeLabelShape,
} as const;

export const canonicalEntityLabelPropsSearchFormatter: LabelPropsSearchFormatter = (
  kind,
  role,
  props,
) => {
  if (role !== "node") {
    return "";
  }

  switch (kind) {
    case "person":
      return nl([
        `Person named ${s(props.name)}.`,
        props.role ? `Role: ${s(props.role)}.` : "",
        props.organization ? `Organization: ${s(props.organization)}.` : "",
        props.timezone ? `Timezone: ${s(props.timezone)}.` : "",
      ]);
    case "place":
      return nl([
        `Place: ${s(props.name)}.`,
        props.kind ? `Kind: ${s(props.kind)}.` : "",
        props.country ? `Country: ${s(props.country)}.` : "",
      ]);
    default:
      return "";
  }
};
