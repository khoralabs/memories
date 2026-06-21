import type { AgentRegistry } from "@khoralabs/agent-capabilities";
import type { AgentTelemetry } from "@khoralabs/agent-capabilities-otel";
import type { LabelSchemaMap, MemoriesClient, MemoriesClientAsync } from "@khoralabs/memories-core";
import type { EmbeddingModel } from "@khoralabs/memories-tools";
import { DEFAULT_MEMORY_TOOL_LOOP_MAX_STEPS } from "@khoralabs/memories-tools";
import type { LanguageModel } from "ai";
import {
  ensureMemoryAdapterAgentRegistered,
  type MemoryAdapterSessionInput,
  type MemoryAdapterSessionOutput,
} from "./adapter-session.js";
import { buildMemoryAdapterAgentId, type DefineMemoryAdapterIdentityOptions } from "./identity.js";
import type { AdapterIngestContext } from "./types.js";

export type MemoryAdapterClientOptions<
  TNode extends LabelSchemaMap,
  TEdge extends LabelSchemaMap,
> = DefineMemoryAdapterIdentityOptions & {
  /** Omitted if every {@link expand} supplies {@code overrides.registry} (e.g. fresh registry per run). */
  registry?: AgentRegistry;
  namespace: string;
  model: LanguageModel;
  client: MemoriesClient<TNode, TEdge> | MemoriesClientAsync<TNode, TEdge>;
  embeddingModel: EmbeddingModel;
  /**
   * When a given {@link expand} call does not set {@code maxSteps} or {@code overrides.maxSteps},
   * this value is used, then the package default ({@link DEFAULT_MEMORY_TOOL_LOOP_MAX_STEPS}).
   */
  defaultMaxSteps?: number;
};

/** Optional per-{@link MemoryAdapterClient["expand"]} values; when set, override the constructor. */
export type MemoryAdapterExpandOverrides<
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
 * Host-facing adapter: durable registry/model/client/namespace wiring + {@link expand} for each ingest run.
 */
export class MemoryAdapterClient<
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

  constructor(options: MemoryAdapterClientOptions<TNode, TEdge>) {
    this.registry = options.registry;
    this.namespace = options.namespace;
    this.model = options.model;
    this.client = options.client;
    this.embeddingModel = options.embeddingModel;
    this.identityContext = options.identityContext;
    this.instructions = options.instructions;
    this.defaultMaxSteps = options.defaultMaxSteps;
  }

  async expand<TDomain = unknown>(args: {
    ingest: AdapterIngestContext;
    domainPayload: TDomain;
    maxSteps?: number;
    memorySearchBudgetMax?: number;
    /** Per-call override of any constructor field (e.g. different registry/namespace in a loop). */
    overrides?: MemoryAdapterExpandOverrides<TNode, TEdge>;
    telemetry?: AgentTelemetry;
  }): Promise<MemoryAdapterSessionOutput> {
    const o = args.overrides ?? {};
    const maxSteps =
      o.maxSteps ?? args.maxSteps ?? this.defaultMaxSteps ?? DEFAULT_MEMORY_TOOL_LOOP_MAX_STEPS;
    const memorySearchBudgetMax = o.memorySearchBudgetMax ?? args.memorySearchBudgetMax;
    const registry = o.registry ?? this.registry;
    if (registry === undefined) {
      throw new Error(
        "MemoryAdapterClient: pass registry in the constructor or in expand({ overrides: { registry } })",
      );
    }
    const namespace = o.namespace ?? this.namespace;
    const model = o.model ?? this.model;
    const client = o.client ?? this.client;
    const embeddingModel = o.embeddingModel ?? this.embeddingModel;

    const { identity } = await ensureMemoryAdapterAgentRegistered(registry, namespace, {
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
      ...(args.telemetry ? { hooks: args.telemetry.sessionHooks } : {}),
    });

    return session.start<MemoryAdapterSessionInput<TDomain>, MemoryAdapterSessionOutput>({
      ingest: args.ingest,
      domainPayload: args.domainPayload,
      maxSteps,
    });
  }

  static adapterAgentId(namespace: string): string {
    return buildMemoryAdapterAgentId(namespace);
  }
}
