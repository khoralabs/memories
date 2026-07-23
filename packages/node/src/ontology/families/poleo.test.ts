import { describe, expect, test } from "bun:test";
import { personNodeLabelShape, placeNodeLabelShape } from "./entities.ts";
import {
  objectNodeLabelShape,
  organizationNodeLabelShape,
  poleoLabelPropsSearchFormatter,
  poleoOntology,
} from "./poleo.ts";
import { eventNodeLabelShape } from "./temporal.ts";

describe("poleo ontology family", () => {
  test("reuses person, place, and event shapes", () => {
    expect(poleoOntology.nodeLabels.person).toBe(personNodeLabelShape);
    expect(poleoOntology.nodeLabels.place).toBe(placeNodeLabelShape);
    expect(poleoOntology.nodeLabels.event).toBe(eventNodeLabelShape);
  });

  test("adds organization and object", () => {
    expect(poleoOntology.nodeLabels.organization).toBe(organizationNodeLabelShape);
    expect(poleoOntology.nodeLabels.object).toBe(objectNodeLabelShape);
  });

  test("formats reused and new label props", () => {
    expect(
      poleoLabelPropsSearchFormatter("person", "node", { name: "Ada", role: "engineer" }),
    ).toBe("Person named Ada.\nRole: engineer.");
    expect(
      poleoLabelPropsSearchFormatter("organization", "node", {
        name: "Acme",
        kind: "company",
      }),
    ).toBe("Organization: Acme.\nKind: company.");
    expect(
      poleoLabelPropsSearchFormatter("object", "node", {
        name: "passport",
        kind: "document",
      }),
    ).toBe("Object: passport.\nKind: document.");
  });
});
