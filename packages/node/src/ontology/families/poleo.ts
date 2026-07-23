import z from "zod";
import type { LabelPropsSearchFormatter } from "../label-props-search.ts";
import { defineOntology } from "../ontology.ts";
import {
  canonicalEntityLabelPropsSearchFormatter,
  personNodeLabelShape,
  placeNodeLabelShape,
} from "./entities.ts";
import { nl, s } from "./format-helpers.ts";
import { canonicalTemporalLabelPropsSearchFormatter, eventNodeLabelShape } from "./temporal.ts";

/**
 * POLE+O (Person, Object, Location, Event + Organization) entity types.
 * Reuses `person` / `place` / `event` from the entities and temporal families;
 * `place` is the Location slot.
 *
 * @see https://neo4j.com/labs/agent-memory/explanation/poleo-model/
 */

export const organizationNodeLabelShape = z
  .object({
    name: z.string().describe("Company, team, agency, school, or other collective."),
    kind: z
      .enum(["company", "nonprofit", "government", "educational", "group", "other"])
      .optional()
      .describe("Organization subtype when known."),
  })
  .describe("A collective entity: company, institution, team, or informal group.");

export const objectNodeLabelShape = z
  .object({
    name: z.string().describe("Short label for the physical or digital item."),
    kind: z
      .enum([
        "vehicle",
        "phone",
        "email",
        "document",
        "device",
        "weapon",
        "money",
        "drug",
        "software",
        "product",
        "other",
      ])
      .optional()
      .describe("Object subtype when known."),
    description: z.string().optional().describe("Brief context if the name alone is ambiguous."),
  })
  .describe("A physical or digital item, artifact, or thing (POLE+O Object catch-all).");

/** POLE+O node kinds: Person, Object, Location (`place`), Event, Organization. */
export const poleoNodeLabelShapes = {
  person: personNodeLabelShape,
  object: objectNodeLabelShape,
  place: placeNodeLabelShape,
  event: eventNodeLabelShape,
  organization: organizationNodeLabelShape,
} as const;

export const poleoOntology = defineOntology({
  nodeLabels: poleoNodeLabelShapes,
  edgeLabels: {},
});

export type PoleoOntology = typeof poleoOntology;
export type PoleoNodeLabels = (typeof poleoOntology)["nodeLabels"];

export const poleoLabelPropsSearchFormatter: LabelPropsSearchFormatter = (kind, role, props) => {
  const fromEntity = canonicalEntityLabelPropsSearchFormatter(kind, role, props);
  if (fromEntity.length > 0) {
    return fromEntity;
  }

  if (kind === "event" && role === "node") {
    return canonicalTemporalLabelPropsSearchFormatter(kind, role, props);
  }

  if (role !== "node") {
    return "";
  }

  switch (kind) {
    case "organization":
      return nl([`Organization: ${s(props.name)}.`, props.kind ? `Kind: ${s(props.kind)}.` : ""]);
    case "object":
      return nl([
        `Object: ${s(props.name)}.`,
        props.kind ? `Kind: ${s(props.kind)}.` : "",
        props.description ? `Description: ${s(props.description)}.` : "",
      ]);
    default:
      return "";
  }
};
