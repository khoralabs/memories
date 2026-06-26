import type { LabelSchemaMap, OntologyDefinition } from "@khoralabs/memories-core";
import { propsSchemaToJson } from "@khoralabs/memories-core";
import {
  STORED_ONTOLOGY_JSON_SCHEMA_URI,
  type StoredOntologyJsonSchema,
  type StoredOntologyJsonSchemaMetadata,
  type StoredOntologyLabelMapSchema,
} from "@khoralabs/memories-service-storage-core";

export {
  /** @deprecated Import from @khoralabs/memories-service-storage-core instead. */
  canonicalizeStoredOntology,
  /** @deprecated Import from @khoralabs/memories-service-storage-core instead. */
  hashStoredOntology,
  /** @deprecated Import from @khoralabs/memories-service-storage-core instead. */
  listOntologyLabelKinds,
  /** @deprecated Import from @khoralabs/memories-service-storage-core instead. */
  normalizeStoredOntologyJsonSchema,
  /** @deprecated Import from @khoralabs/memories-service-storage-core instead. */
  type OntologyLabelKinds,
  /** @deprecated Import from @khoralabs/memories-service-storage-core instead. */
  ontologyMatchesLabelKinds,
  /** @deprecated Import from @khoralabs/memories-service-storage-core instead. */
  STORED_ONTOLOGY_JSON_SCHEMA_URI,
  /** @deprecated Import from @khoralabs/memories-service-storage-core instead. */
  type StoredOntologyJsonSchema,
  /** @deprecated Import from @khoralabs/memories-service-storage-core instead. */
  type StoredOntologyJsonSchemaMetadata,
  /** @deprecated Import from @khoralabs/memories-service-storage-core instead. */
  type StoredOntologyLabelMapSchema,
} from "@khoralabs/memories-service-storage-core";

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
