import { canonicalEntityNodeLabelShapes } from "./families/entities.ts";
import { canonicalKnowledgeNodeLabelShapes } from "./families/knowledge.ts";
import { canonicalPreferenceNodeLabelShapes } from "./families/preferences.ts";
import { canonicalRelationEdgeLabelShapes } from "./families/relations.ts";
import {
  canonicalTemporalEdgeLabelShapes,
  canonicalTemporalNodeLabelShapes,
} from "./families/temporal.ts";
import { defineOntology } from "./ontology.ts";

/**
 * Default graph vocabulary for personal/agent memory: people, places, time, facts, and how they relate.
 *
 * @deprecated Import family exports from `@khoralabs/memories-ontologies/families/*`
 * or `@khoralabs/memories-ontologies` and assemble an app-specific ontology.
 */
export const canonicalOntology = defineOntology({
  nodeLabels: {
    ...canonicalEntityNodeLabelShapes,
    ...canonicalPreferenceNodeLabelShapes,
    ...canonicalTemporalNodeLabelShapes,
    ...canonicalKnowledgeNodeLabelShapes,
  },
  edgeLabels: {
    ...canonicalRelationEdgeLabelShapes,
    ...canonicalTemporalEdgeLabelShapes,
  },
});
