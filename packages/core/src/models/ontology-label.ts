/**
 * One ontology label assignment instance: catalog **kind** plus JSON **props** (validated by Zod / JSON Schema).
 */
export type OntologyLabelInstance = {
  kind: string;
  /** Properties for this kind; omit or `{}` when the kind has no fields. */
  props: Record<string, unknown>;
};
