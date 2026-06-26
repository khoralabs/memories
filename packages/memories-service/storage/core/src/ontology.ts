import { createHash } from "node:crypto";

export const STORED_ONTOLOGY_JSON_SCHEMA_URI = "https://json-schema.org/draft/2020-12/schema";

export type StoredOntologyJsonSchemaMetadata = {
  $id?: string;
  title?: string;
  description?: string;
};

export type StoredOntologyLabelMapSchema = {
  type: "object";
  additionalProperties: false;
  properties: Record<string, Record<string, unknown>>;
};

export type StoredOntologyJsonSchema = {
  $schema: typeof STORED_ONTOLOGY_JSON_SCHEMA_URI;
  $id?: string;
  title?: string;
  description?: string;
  type: "object";
  properties: {
    nodeLabels: StoredOntologyLabelMapSchema;
    edgeLabels: StoredOntologyLabelMapSchema;
  };
  required: ["nodeLabels", "edgeLabels"];
  additionalProperties: false;
};

export type OntologyLabelKinds = {
  nodeKinds: string[];
  edgeKinds: string[];
};

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortJsonValue((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

export function listOntologyLabelKinds(schema: StoredOntologyJsonSchema): OntologyLabelKinds {
  return {
    nodeKinds: Object.keys(schema.properties.nodeLabels.properties).sort(),
    edgeKinds: Object.keys(schema.properties.edgeLabels.properties).sort(),
  };
}

export function canonicalizeStoredOntology(schema: StoredOntologyJsonSchema): string {
  return JSON.stringify(sortJsonValue(schema));
}

export function hashStoredOntology(schema: StoredOntologyJsonSchema): string {
  return createHash("sha256").update(canonicalizeStoredOntology(schema)).digest("hex");
}

function includesAllKinds(stored: string[], required: string[] | undefined): boolean {
  if (required === undefined || required.length === 0) return true;
  const storedSet = new Set(stored);
  return required.every((kind) => storedSet.has(kind));
}

export function ontologyMatchesLabelKinds(
  schema: StoredOntologyJsonSchema,
  filter?: { nodeKinds?: string[]; edgeKinds?: string[] },
): boolean {
  if (filter === undefined) return true;
  const kinds = listOntologyLabelKinds(schema);
  return (
    includesAllKinds(kinds.nodeKinds, filter.nodeKinds) &&
    includesAllKinds(kinds.edgeKinds, filter.edgeKinds)
  );
}

export function normalizeStoredOntologyJsonSchema(
  schema: StoredOntologyJsonSchema,
): StoredOntologyJsonSchema {
  return JSON.parse(canonicalizeStoredOntology(schema)) as StoredOntologyJsonSchema;
}
