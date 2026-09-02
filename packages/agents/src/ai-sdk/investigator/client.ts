import type { AgentRegistry } from "@khoralabs/agent-capabilities";
import type { AgentTelemetry } from "@khoralabs/agent-capabilities-otel";
import type { MemoriesClient, MemoriesClientAsync } from "@khoralabs/memories-node";
import type { EmbeddingModel } from "@khoralabs/memories-node/helpers";
import type { LabelSchemaMap } from "@khoralabs/memories-node/ontology";
import {
  buildMemoryInvestigatorAgentId,
  type DefineMemoryInvestigatorIdentityOptions,
} from "../../investigator/identity.js";
import type { InvestigatorAnswerWire } from "../../investigator/investigator-output.js";
import { memoryAgentSessionHooks } from "../../tools/agent-telemetry.js";
import { DEFAULT_INVESTIGATOR_MAX_STEPS } from "../../tools/memory-agent-defaults.js";
import type { InvestigatorPipelineGeneration } from "./create-investigator-agent.js";
import {
  ensureMemoryInvestigatorAgentRegistered,
  type MemoryInvestigatorSessionInput,
  type MemoryInvestigatorSessionOutput,
} from "./investigator-session.js";

export type MemoryInvestigatorClientOptions<
  TNode extends LabelSchemaMap,
  TEdge extends LabelSchemaMap,
> = DefineMemoryInvestigatorIdentityOptions & {
  registry?: AgentRegistry;
  /** Primary namespace subtree root for search (see `@khoralabs/memories-node` SearchParams). */
  namespace: string;
  model: string;
  client: MemoriesClient<TNode, TEdge> | MemoriesClientAsync<TNode, TEdge>;
  embeddingModel: EmbeddingModel;
  defaultMaxSteps?: number;
};

export type MemoryInvestigatorInvestigateOverrides<
  TNode extends LabelSchemaMap,
  TEdge extends LabelSchemaMap,
> = {
  maxSteps?: number;
  memorySearchBudgetMax?: number;
  namespace?: string;
  additionalNamespaces?: readonly string[];
  memorySearchExtensions?: Record<string, unknown>;
  model?: string;
  client?: MemoriesClient<TNode, TEdge> | MemoriesClientAsync<TNode, TEdge>;
  embeddingModel?: EmbeddingModel;
  registry?: AgentRegistry;
};

/**
 * Host-facing investigator: registry/model/client/namespace wiring + {@link investigate} per question.
 */
export class MemoryInvestigatorClient<
  TNode extends LabelSchemaMap = LabelSchemaMap,
  TEdge extends LabelSchemaMap = LabelSchemaMap,
> {
  readonly registry: AgentRegistry | undefined;
  readonly namespace: string;
  readonly model: string;
  readonly client: MemoriesClient<TNode, TEdge> | MemoriesClientAsync<TNode, TEdge>;
  readonly embeddingModel: EmbeddingModel;
  readonly identityContext: Record<string, unknown> | undefined;
  readonly instructions: string[] | undefined;
  readonly additionalNamespaces: readonly string[] | undefined;
  readonly extraToolMembers: DefineMemoryInvestigatorIdentityOptions["extraToolMembers"];
  readonly defaultMaxSteps: number | undefined;

  constructor(options: MemoryInvestigatorClientOptions<TNode, TEdge>) {
    this.registry = options.registry;
    this.namespace = options.namespace;
    this.model = options.model;
    this.client = options.client;
    this.embeddingModel = options.embeddingModel;
    this.identityContext = options.identityContext;
    this.instructions = options.instructions;
    this.additionalNamespaces = options.additionalNamespaces;
    this.extraToolMembers = options.extraToolMembers;
    this.defaultMaxSteps = options.defaultMaxSteps;
  }

  async investigate(args: {
    question: string;
    maxSteps?: number;
    memorySearchBudgetMax?: number;
    overrides?: MemoryInvestigatorInvestigateOverrides<TNode, TEdge>;
    telemetry?: AgentTelemetry;
    signal?: AbortSignal;
  }): Promise<{
    answer: InvestigatorAnswerWire;
    generation: InvestigatorPipelineGeneration;
  }> {
    const o = args.overrides ?? {};
    const maxSteps =
      o.maxSteps ?? args.maxSteps ?? this.defaultMaxSteps ?? DEFAULT_INVESTIGATOR_MAX_STEPS;
    const memorySearchBudgetMax = o.memorySearchBudgetMax ?? args.memorySearchBudgetMax;
    const registry = o.registry ?? this.registry;
    if (registry === undefined) {
      throw new Error(
        "MemoryInvestigatorClient: pass registry in the constructor or in investigate({ overrides: { registry } })",
      );
    }
    const namespace = o.namespace ?? this.namespace;
    const model = o.model ?? this.model;
    const client = o.client ?? this.client;
    const embeddingModel = o.embeddingModel ?? this.embeddingModel;
    const additionalNamespaces = o.additionalNamespaces ?? this.additionalNamespaces;
    const memorySearchExtensions = o.memorySearchExtensions;

    const { identity } = await ensureMemoryInvestigatorAgentRegistered(registry, namespace, {
      ...(this.identityContext !== undefined ? { identityContext: this.identityContext } : {}),
      ...(this.instructions !== undefined ? { instructions: this.instructions } : {}),
      ...(additionalNamespaces !== undefined ? { additionalNamespaces } : {}),
      ...(this.extraToolMembers !== undefined ? { extraToolMembers: this.extraToolMembers } : {}),
    });

    const session = registry.createSession(identity.agentId, {
      ctx: {
        model,
        client,
        embeddingModel,
        namespace,
        ...(additionalNamespaces !== undefined ? { additionalNamespaces } : {}),
        ...(memorySearchExtensions !== undefined ? { memorySearchExtensions } : {}),
        ...(memorySearchBudgetMax !== undefined ? { memorySearchBudgetMax } : {}),
      },
      ...(args.signal !== undefined ? { signal: args.signal } : {}),
      ...(args.telemetry
        ? { hooks: await memoryAgentSessionHooks({ client, telemetry: args.telemetry }) }
        : {}),
    });

    return session.start<MemoryInvestigatorSessionInput, MemoryInvestigatorSessionOutput>({
      question: args.question,
      maxSteps,
    });
  }

  static async investigatorAgentId(options: {
    primaryNamespace: string;
    additionalNamespaces?: readonly string[];
    extraToolMembers?: DefineMemoryInvestigatorIdentityOptions["extraToolMembers"];
  }): Promise<string> {
    return buildMemoryInvestigatorAgentId({
      primaryNamespace: options.primaryNamespace,
      additionalNamespaces: options.additionalNamespaces,
      extraToolMembers: options.extraToolMembers,
    });
  }
}
