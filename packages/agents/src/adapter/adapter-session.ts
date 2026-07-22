import type {
  AgentRegistry,
  RegisterAgentOptions,
  RegisteredAgent,
  SessionContext,
  SessionRunner,
} from "@khoralabs/agent-capabilities";
import type { LanguageModel } from "ai";
import {
  attachMemorySearchSessionLayer,
  type MemorySearchSessionContextSlice,
  type ZodLabelMap,
} from "../tools/index";
import { parseAdapterGenerationToExpandedMemoryWire } from "./adapter-output.js";
import type { AdapterPipelineGeneration } from "./create-adapter-agent.js";
import { createMemoryAdapterAgent } from "./create-adapter-agent.js";
import {
  buildMemoryAdapterAgentId,
  type DefineMemoryAdapterIdentityOptions,
  defineMemoryAdapterIdentity,
} from "./identity.js";
import { buildMemoryAdapterUserMessage } from "./messages.js";
import type { AdapterIngestContext, ExpandedMemoryDraft } from "./types.js";

export type MemoryAdapterSessionContext<
  TNode extends ZodLabelMap,
  TEdge extends ZodLabelMap,
> = SessionContext &
  MemorySearchSessionContextSlice<TNode, TEdge> & {
    model: LanguageModel;
  };

/** Domain payload is app-defined; validate at the host before calling the adapter. */
export type MemoryAdapterSessionInput<TDomain = unknown> = {
  ingest: AdapterIngestContext;
  domainPayload: TDomain;
  maxSteps: number;
};

export type MemoryAdapterSessionOutput = {
  generation: AdapterPipelineGeneration;
  draft: ExpandedMemoryDraft;
};

/**
 * Full static definition: identity (capabilities hash) + session registration for {@link AgentRegistry.register}.
 */
export async function getMemoryAdapterAgentDefinition(
  namespace: string,
  options?: DefineMemoryAdapterIdentityOptions,
): Promise<{
  staticHash: string;
  identity: RegisteredAgent;
  registerOptions: RegisterAgentOptions<
    MemoryAdapterSessionInput<unknown>,
    MemoryAdapterSessionOutput,
    MemoryAdapterSessionContext<ZodLabelMap, ZodLabelMap>
  >;
}> {
  const { staticHash, identity } = await defineMemoryAdapterIdentity(namespace, options);
  return {
    staticHash,
    identity,
    registerOptions: {
      run: createMemoryAdapterSessionRunner<ZodLabelMap, ZodLabelMap>(),
      hooks: {
        async onAfterContext(args) {
          const { agent, context, input } = args;
          await attachMemorySearchSessionLayer({
            agent,
            context,
          });
          void input;
        },
      },
    },
  };
}

/**
 * Registers the memory adapter on {@code registry} if not already present (same agent id for {@code namespace}).
 */
export async function ensureMemoryAdapterAgentRegistered(
  registry: AgentRegistry,
  namespace: string,
  options?: DefineMemoryAdapterIdentityOptions,
): Promise<{ staticHash: string; identity: RegisteredAgent }> {
  const id = buildMemoryAdapterAgentId(namespace);
  if (registry.has(id)) {
    const entry = registry.get(id);
    if (!entry) {
      throw new Error(`registry inconsistency: has(${id}) but get is undefined`);
    }
    return { staticHash: entry.agent.staticHash, identity: entry.agent };
  }
  const { staticHash, identity, registerOptions } = await getMemoryAdapterAgentDefinition(
    namespace,
    options,
  );
  registry.register(identity, registerOptions);
  return { staticHash, identity };
}

export const registerMemoryAdapterAgent = ensureMemoryAdapterAgentRegistered;

export function createMemoryAdapterSessionRunner<
  TNode extends ZodLabelMap,
  TEdge extends ZodLabelMap,
>(): SessionRunner<
  MemoryAdapterSessionInput<unknown>,
  MemoryAdapterSessionOutput,
  MemoryAdapterSessionContext<TNode, TEdge>
> {
  return async ({ agent, input, context }) => {
    const { model } = context;
    const { ingest, domainPayload, maxSteps } = input;

    if (!context.toolkitCtx || !context.runtime || !context.affordances) {
      throw new Error(
        "memory adapter session context missing toolkit/runtime/affordances (onAfterContext hook)",
      );
    }

    const adapterAgent = createMemoryAdapterAgent({
      model,
      identity: agent,
      affordances: context.affordances,
      runtime: context.runtime,
      ontology: context.client.ontology,
      maxSteps,
    });

    const messages = [buildMemoryAdapterUserMessage({ ingest, domainPayload })];
    const generation = await adapterAgent.generate({
      messages,
      ...(context.abortSignal ? { abortSignal: context.abortSignal } : {}),
    });

    const v = parseAdapterGenerationToExpandedMemoryWire(context.client.ontology, generation);

    const draft: ExpandedMemoryDraft = {
      plaintext: v.plaintext,
      memoryKeySuggestion: v.memoryKeySuggestion?.trim(),
      nodeLabelHints: v.nodeLabelHints,
      edgeLabelHints: v.edgeLabelHints,
    };

    return { generation, draft };
  };
}
