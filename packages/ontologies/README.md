# @khoralabs/memories-ontologies

Default ontology vocabulary for personal and agent memory graphs. Defines node and edge label kinds with Zod schemas used by `defineOntology` from `@khoralabs/memories-core`.

## Exports

- **Canonical families** — grouped shape maps and formatters such as `canonicalEntityNodeLabelShapes`, `canonicalKnowledgeNodeLabelShapes`, `canonicalTemporalNodeLabelShapes`, `canonicalRelationEdgeLabelShapes`, and `canonicalEntityLabelPropsSearchFormatter`.
- **Individual canonical shapes** — Zod schemas such as `personNodeLabelShape`, `factNodeLabelShape`, and `referencesEdgeLabelShape` for assembling only the ontology pieces your implementation needs.
- **`canonicalOntology`** — deprecated compatibility export assembled from the family maps.
- **`canonicalLabelPropsSearchFormatter`** — formatter for canonical ontology kinds in label-props search text.

## Usage

Assemble the shapes you need:

```ts
import { defineOntology } from "@khoralabs/memories-core";
import {
  canonicalEntityNodeLabelShapes,
  canonicalKnowledgeNodeLabelShapes,
  canonicalRelationEdgeLabelShapes,
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
