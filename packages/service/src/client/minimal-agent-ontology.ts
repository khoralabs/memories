import { defineOntology } from "@khoralabs/memories-node/ontology";
import { z } from "zod";

export const AGENT_MEMORY_NODE_KIND = "Memory" as const;
export const AGENT_MEMORY_EDGE_KIND = "References" as const;

const emptyProps = z.object({});

/** Baseline ontology for agent memory writes when apps omit Memory/References kinds. */
export const minimalAgentMemoriesOntology = defineOntology({
  nodeLabels: {
    [AGENT_MEMORY_NODE_KIND]: emptyProps.describe("Generic text memory written by agent tools."),
  },
  edgeLabels: {
    [AGENT_MEMORY_EDGE_KIND]: emptyProps.describe(
      "Default peer link when writeMemory omits an edge label kind.",
    ),
  },
});
