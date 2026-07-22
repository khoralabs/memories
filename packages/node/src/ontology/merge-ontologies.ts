import { defineOntology, type LabelSchemaMap, type OntologyDefinition } from "./ontology.ts";

type OntologyDef = OntologyDefinition<LabelSchemaMap, LabelSchemaMap>;

type MergeTwo<A extends OntologyDef, B extends OntologyDef> =
  A extends OntologyDefinition<infer NA, infer EA>
    ? B extends OntologyDefinition<infer NB, infer EB>
      ? OntologyDefinition<NA & NB, EA & EB>
      : never
    : never;

/** Left-to-right fold: first ontology's keys are overwritten by later ones on collision. */
export type MergeOntologyTuple<T extends readonly OntologyDef[]> = T extends readonly []
  ? never
  : T extends readonly [infer Only extends OntologyDef]
    ? Only
    : T extends readonly [
          infer Head extends OntologyDef,
          ...infer Tail extends readonly OntologyDef[],
        ]
      ? Tail extends readonly []
        ? Head
        : MergeTwo<Head, MergeOntologyTuple<Tail>>
      : never;

/**
 * Merge any number of ontologies by spreading `nodeLabels` and `edgeLabels` in order.
 * On key collision, **later** arguments win.
 */
export function mergeOntologies<
  T extends readonly OntologyDefinition<LabelSchemaMap, LabelSchemaMap>[],
>(...defs: [...T]): MergeOntologyTuple<T> {
  if (defs.length === 0) {
    throw new Error("mergeOntologies: expected at least one ontology");
  }
  const [head, ...tail] = defs;
  const merged = tail.reduce(
    (acc, d) =>
      defineOntology({
        nodeLabels: { ...acc.nodeLabels, ...d.nodeLabels },
        edgeLabels: { ...acc.edgeLabels, ...d.edgeLabels },
      }),
    head,
  );
  return merged as MergeOntologyTuple<T>;
}
