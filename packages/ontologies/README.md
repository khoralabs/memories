# @khoralabs/memories-ontologies

Default ontology vocabulary for personal and agent memory graphs. Defines node and edge label kinds with Zod schemas used by `defineOntology` from `@khoralabs/memories-core`.

## Exports

- **`canonicalOntology`** — baseline vocabulary: `person`, `place`, `preference`, `fact`, `event`, `task`, `document`, and edge kinds such as `knows`, `located_at`, `related_to`, `part_of`, `mentions`, `scheduled_for`.
- **`canonicalLabelPropsSearchFormatter`** — formatter for canonical ontology kinds in label-props search text.

## Usage

Use as-is for demos and personal-memory apps, or merge with your own ontology:

```ts
import { defineOntology } from "@khoralabs/memories-core";
import { mergeOntologies } from "@khoralabs/memories-core/helpers";
import { canonicalOntology } from "@khoralabs/memories-ontologies";
import { retrievalAutolinkOntology } from "@khoralabs/memories-autolink";

export const appOntology = mergeOntologies(canonicalOntology, retrievalAutolinkOntology);
export type AppOntology = typeof appOntology;

const client = new MemoriesClient(appOntology, { persistence });
```

On kind collision, the **last** argument to `mergeOntologies` wins.

## Custom ontologies

For app-specific vocabularies, call `defineOntology` directly with your own Zod node/edge label maps. Keep kinds stable across merges — they hash into catalog and assignment IDs in persistence.
