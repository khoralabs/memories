import type { LabelSchemaMap, OntologyDefinition } from "@khoralabs/memories-node/ontology";
import { Output } from "ai";
import {
  type ExpandedMemoryWireOptions,
  zExpandedMemoryWireFromOntology,
} from "../adapter/adapter-output.js";
import {
  type IntegratorPlanWireOptions,
  zIntegratorPlanWire,
} from "../integrator/integrator-output.js";
import { zInvestigatorAnswerWire } from "../investigator/investigator-output.js";

export function memoryAdapterExpandedOutput<
  TNode extends LabelSchemaMap,
  TEdge extends LabelSchemaMap,
>(
  ontology: OntologyDefinition<TNode, TEdge>,
  options?: ExpandedMemoryWireOptions,
): ReturnType<typeof Output.object> {
  return Output.object({
    name: "ExpandedMemory",
    description:
      "Expanded domain content as plaintext plus optional memory key and ontology-aware node/edge label hints for ingestion.",
    schema: zExpandedMemoryWireFromOntology(ontology, options),
  });
}

export type MemoryAdapterStructuredOutput = ReturnType<typeof memoryAdapterExpandedOutput>;

export function integratorPlanOutputFromOntology<
  TNode extends LabelSchemaMap,
  TEdge extends LabelSchemaMap,
>(
  ontology: OntologyDefinition<TNode, TEdge>,
  options?: IntegratorPlanWireOptions,
): ReturnType<typeof Output.object> {
  return Output.object({
    name: "MemoryIntegratorPlan",
    description:
      "MemoryIntegratorPlan: nodeLabels is an object with optional keys per ontology node kind; each edge row sets memory, direction, and exactly one optional field named for an ontology edge kind (that field's value is the payload).",
    schema: zIntegratorPlanWire(ontology, options),
  });
}

/** Alias for phase-2 plan generation with search-derived neighbor keys. */
export const buildIntegratorPlanOutput = integratorPlanOutputFromOntology;

export type IntegratorPlanStructuredOutput = ReturnType<typeof integratorPlanOutputFromOntology>;

export function investigatorAnswerOutput(): ReturnType<typeof Output.object> {
  return Output.object({
    name: "MemoryInvestigatorAnswer",
    description:
      "Structured answer after memory_search: main answer text, optional citations (memory_key + rationale), optional follow-up queries.",
    schema: zInvestigatorAnswerWire,
  });
}

export type InvestigatorStructuredOutput = ReturnType<typeof investigatorAnswerOutput>;
