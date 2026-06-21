import type { AgentRegistry } from "@khoralabs/agent-capabilities";
import type { AgentTelemetry } from "@khoralabs/agent-capabilities-otel";
import type { LabelSchemaMap, MemoriesClient, MemoriesClientAsync } from "@khoralabs/memories-core";
import type { EmbeddingModel } from "@khoralabs/memories-tools";
import {
  DEFAULT_MEMORY_TOOL_LOOP_MAX_STEPS,
  memoryAgentSessionHooks,
} from "@khoralabs/memories-tools";
import type { LanguageModel } from "ai";
import type { IntegratorPipelineGeneration } from "./create-integrator-agent.js";
import {
  buildMemoryIntegratorAgentId,
  type DefineMemoryIntegratorIdentityOptions,
} from "./identity.js";
import type { IntegratorPlanWire } from "./integrator-output.js";
import {
  ensureMemoryIntegratorAgentRegistered,
  type MemoryIntegratorSessionInput,
  type MemoryIntegratorSessionOutput,
} from "./integrator-session.js";

export type MemoryIntegratorClientOptions<
  TNode extends LabelSchemaMap,
  TEdge extends LabelSchemaMap,
> = DefineMemoryIntegratorIdentityOptions & {
  /** Omitted if every {@link MemoryIntegratorClient.integrate} supplies {@code overrides.registry} (e.g. fresh registry per run). */
  registry?: AgentRegistry;
  namespace: string;
  model: LanguageModel;
  client: MemoriesClient<TNode, TEdge> | MemoriesClientAsync<TNode, TEdge>;
  embeddingModel: EmbeddingModel;
  /**
   * When a given {@link integrate} call does not set {@code maxSteps} or {@code overrides.maxSteps},
   * this value is used, then the package default ({@link DEFAULT_MEMORY_TOOL_LOOP_MAX_STEPS}).
   */
  defaultMaxSteps?: number;
};

export type MemoryIntegratorIntegrateOverrides<
  TNode extends LabelSchemaMap,
  TEdge extends LabelSchemaMap,
> = {
  maxSteps?: number;
  memorySearchBudgetMax?: number;
  namespace?: string;
  model?: LanguageModel;
  client?: MemoriesClient<TNode, TEdge> | MemoriesClientAsync<TNode, TEdge>;
  embeddingModel?: EmbeddingModel;
  registry?: AgentRegistry;
};

/**
 * Host-facing integrator: durable registry/model/client/namespace wiring + {@link integrate} for each run.
 */
export class MemoryIntegratorClient<
  TNode extends LabelSchemaMap = LabelSchemaMap,
  TEdge extends LabelSchemaMap = LabelSchemaMap,
> {
  readonly registry: AgentRegistry | undefined;
  readonly namespace: string;
  readonly model: LanguageModel;
  readonly client: MemoriesClient<TNode, TEdge> | MemoriesClientAsync<TNode, TEdge>;
  readonly embeddingModel: EmbeddingModel;
  readonly identityContext: Record<string, unknown> | undefined;
  readonly instructions: string[] | undefined;
  readonly defaultMaxSteps: number | undefined;

  constructor(options: MemoryIntegratorClientOptions<TNode, TEdge>) {
    this.registry = options.registry;
    this.namespace = options.namespace;
    this.model = options.model;
    this.client = options.client;
    this.embeddingModel = options.embeddingModel;
    this.identityContext = options.identityContext;
    this.instructions = options.instructions;
    this.defaultMaxSteps = options.defaultMaxSteps;
  }

  async integrate(args: {
    content: string;
    maxSteps?: number;
    memorySearchBudgetMax?: number;
    /** Per-call override of any constructor field (e.g. different registry/namespace in a loop). */
    overrides?: MemoryIntegratorIntegrateOverrides<TNode, TEdge>;
    telemetry?: AgentTelemetry;
    signal?: AbortSignal;
  }): Promise<{
    plan: IntegratorPlanWire;
    generation: IntegratorPipelineGeneration;
    discoveredMemoryKeys: string[];
  }> {
    const o = args.overrides ?? {};
    const maxSteps =
      o.maxSteps ?? args.maxSteps ?? this.defaultMaxSteps ?? DEFAULT_MEMORY_TOOL_LOOP_MAX_STEPS;
    const memorySearchBudgetMax = o.memorySearchBudgetMax ?? args.memorySearchBudgetMax;
    const registry = o.registry ?? this.registry;
    if (registry === undefined) {
      throw new Error(
        "MemoryIntegratorClient: pass registry in the constructor or in integrate({ overrides: { registry } })",
      );
    }
    const namespace = o.namespace ?? this.namespace;
    const model = o.model ?? this.model;
    const client = o.client ?? this.client;
    const embeddingModel = o.embeddingModel ?? this.embeddingModel;

    const { identity } = await ensureMemoryIntegratorAgentRegistered(registry, namespace, {
      ...(this.identityContext !== undefined ? { identityContext: this.identityContext } : {}),
      ...(this.instructions !== undefined ? { instructions: this.instructions } : {}),
    });

    const session = registry.createSession(identity.agentId, {
      ctx: {
        model,
        client,
        embeddingModel,
        namespace,
        ...(memorySearchBudgetMax !== undefined ? { memorySearchBudgetMax } : {}),
      },
      ...(args.signal !== undefined ? { signal: args.signal } : {}),
      ...(args.telemetry
        ? { hooks: await memoryAgentSessionHooks({ client, telemetry: args.telemetry }) }
        : {}),
    });

    return session
      .start<MemoryIntegratorSessionInput, MemoryIntegratorSessionOutput>({
        content: args.content,
        maxSteps,
      })
      .then((result) => ({
        plan: result.plan,
        generation: result.generation,
        discoveredMemoryKeys: result.discoveredMemoryKeys,
      }));
  }

  static integratorAgentId(namespace: string): string {
    return buildMemoryIntegratorAgentId(namespace);
  }
}
