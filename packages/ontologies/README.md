# @khoralabs/memories-ontologies

Ontology contracts, merge helpers, and default vocabulary families for personal and agent memory graphs.

## Exports

- **Canonical families** — grouped shape maps and formatters such as `canonicalEntityNodeLabelShapes`, `canonicalKnowledgeNodeLabelShapes`, `canonicalTemporalNodeLabelShapes`, `canonicalRelationEdgeLabelShapes`, `canonicalRetrievalEdgeLabelShapes`, and `canonicalEntityLabelPropsSearchFormatter`.
- **Individual canonical shapes** — Zod schemas such as `personNodeLabelShape`, `factNodeLabelShape`, and `referencesEdgeLabelShape` for assembling only the ontology pieces your implementation needs.
- **`canonicalOntology`** — deprecated compatibility export assembled from the family maps.
- **`canonicalLabelPropsSearchFormatter`** — formatter for canonical ontology kinds in label-props search text.
- **`defineOntology` / `mergeOntologies`** — ontology construction and composition helpers.

## Usage

Assemble the shapes you need:

```ts
import {
  canonicalEntityNodeLabelShapes,
  canonicalKnowledgeNodeLabelShapes,
  canonicalRelationEdgeLabelShapes,
  defineOntology,
} from "@khoralabs/memories-ontologies";

export const appOntology = defineOntology({
  nodeLabels: {
    ...canonicalEntityNodeLabelShapes,
    ...canonicalKnowledgeNodeLabelShapes,
  },
  edgeLabels: {
    ...canonicalRelationEdgeLabelShapes,
  },
});

const client = new MemoriesClient(appOntology, { persistence });
```

Families are also available as subpath imports, for example
`@khoralabs/memories-ontologies/families/entities`.
`canonicalOntology` is still exported for compatibility, but new code should assemble shapes directly.

On kind collision, the **last** argument to `mergeOntologies` wins.

## Custom ontologies

For app-specific vocabularies, call `defineOntology` directly with your own Zod node/edge label maps. Keep kinds stable across merges — they hash into catalog and assignment IDs in persistence.
