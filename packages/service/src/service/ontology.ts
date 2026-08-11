import type { LabelSchemaMap, OntologyDefinition } from "@khoralabs/memories-node/ontology";
import { propsSchemaToJson } from "@khoralabs/memories-node/ontology";
import {
  STORED_ONTOLOGY_JSON_SCHEMA_URI,
  type StoredOntologyJsonSchema,
  type StoredOntologyJsonSchemaMetadata,
  type StoredOntologyLabelMapSchema,
} from "../storage/core/index";

function labelMapFromOntology<T extends LabelSchemaMap>(labels: T): StoredOntologyLabelMapSchema {
  const properties: Record<string, Record<string, unknown>> = {};
  for (const kind of Object.keys(labels).sort()) {
    const schema = labels[kind as keyof T];
    if (schema === undefined) continue;
    properties[kind] = propsSchemaToJson(schema);
  }
  return {
    type: "object",
    additionalProperties: false,
    properties,
  };
}

export function ontologyToStoredJsonSchema<
  TNode extends LabelSchemaMap,
  TEdge extends LabelSchemaMap,
>(
  ontology: OntologyDefinition<TNode, TEdge>,
  metadata?: StoredOntologyJsonSchemaMetadata,
): StoredOntologyJsonSchema {
  return {
    $schema: STORED_ONTOLOGY_JSON_SCHEMA_URI,
    ...metadata,
    type: "object",
    properties: {
      nodeLabels: labelMapFromOntology(ontology.nodeLabels),
      edgeLabels: labelMapFromOntology(ontology.edgeLabels),
    },
    required: ["nodeLabels", "edgeLabels"],
    additionalProperties: false,
  };
}
