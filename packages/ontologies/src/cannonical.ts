import { defineOntology } from "@khoralabs/memories-core";
import { canonicalEntityNodeLabelShapes } from "./families/entities";
import { canonicalKnowledgeNodeLabelShapes } from "./families/knowledge";
import { canonicalPreferenceNodeLabelShapes } from "./families/preferences";
import { canonicalRelationEdgeLabelShapes } from "./families/relations";
import {
  canonicalTemporalEdgeLabelShapes,
  canonicalTemporalNodeLabelShapes,
} from "./families/temporal";

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
