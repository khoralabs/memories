import type { LabelSchemaMap } from "@khoralabs/memories-node/ontology";
import Ajv from "ajv";
import type { StoredOntologyJsonSchema } from "../storage/core/index";

const ajv = new Ajv({ allErrors: true, strict: false });

/**
 * Standard Schema + JSON Schema facade over a stored per-label props schema.
 * Used so HTTP merge can validate against the DB-linked ontology via Ajv while still
 * satisfying mergeMemory → propsSchemaToJson for catalog persistence.
 */
export function labelSchemaFromStoredPropsJson(
  propsJsonSchema: Record<string, unknown>,
): LabelSchemaMap[string] {
  // Clone so compile/validate never mutates the registry document.
  const schemaForCatalog = structuredClone(propsJsonSchema);
  const schemaForAjv = structuredClone(propsJsonSchema);
  // Zod’s toJSONSchema / stored docs may set `$schema` to Draft 2020-12; default Ajv
  // treats that URL as a missing ref. Strip it — instance validation does not need it.
  delete schemaForAjv.$schema;
  const validate = ajv.compile(schemaForAjv);

  return {
    "~standard": {
      version: 1,
      vendor: "memories-service-stored-ontology",
      validate(value: unknown) {
        if (value === null || typeof value !== "object" || Array.isArray(value)) {
          return { issues: [{ message: "Expected object props" }] };
        }
        if (!validate(value)) {
          return {
            issues: [{ message: ajv.errorsText(validate.errors) || "Invalid label props" }],
          };
        }
        return { value: value as Record<string, unknown> };
      },
      jsonSchema: {
        input: () => schemaForCatalog,
        output: () => schemaForCatalog,
      },
    },
  } as LabelSchemaMap[string];
}

/** Runtime label maps for kinds present on a stored ontology document. */
export function labelMapsFromStoredOntology(schema: StoredOntologyJsonSchema): {
  nodeLabels: LabelSchemaMap;
  edgeLabels: LabelSchemaMap;
} {
  const nodeLabels: LabelSchemaMap = {};
  for (const [kind, propsSchema] of Object.entries(schema.properties.nodeLabels.properties)) {
    nodeLabels[kind] = labelSchemaFromStoredPropsJson(propsSchema);
  }
  const edgeLabels: LabelSchemaMap = {};
  for (const [kind, propsSchema] of Object.entries(schema.properties.edgeLabels.properties)) {
    edgeLabels[kind] = labelSchemaFromStoredPropsJson(propsSchema);
  }
  return { nodeLabels, edgeLabels };
}
