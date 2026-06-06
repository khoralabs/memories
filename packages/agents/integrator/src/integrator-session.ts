import type {
  AgentRegistry,
  RegisterAgentOptions,
  RegisteredAgent,
  SessionContext,
  SessionRunner,
} from "@khoralabs/agent-capabilities";
import {
  attachMemorySearchSessionLayer,
  type MemorySearchSessionContextSlice,
  type ZodLabelMap,
} from "@khoralabs/memories-tools";
import { type LanguageModel, NoObjectGeneratedError, NoOutputGeneratedError } from "ai";
import type { IntegratorPipelineGeneration } from "./create-integrator-agent.js";
import { createMemoryIntegratorAgent } from "./create-integrator-agent.js";
import {
  buildMemoryIntegratorAgentId,
  type DefineMemoryIntegratorIdentityOptions,
  defineMemoryIntegratorIdentity,
} from "./identity.js";
import { type IntegratorPlanWire, parseIntegratorPlanWire } from "./integrator-output.js";
import { buildMemoryIntegratorUserMessage } from "./messages.js";

export type MemoryIntegratorSessionContext<
  TNode extends ZodLabelMap,
  TEdge extends ZodLabelMap,
> = SessionContext &
  MemorySearchSessionContextSlice<TNode, TEdge> & {
    model: LanguageModel;
  };

export type MemoryIntegratorSessionInput = {
  content: string;
  maxSteps: number;
};

export type MemoryIntegratorSessionOutput = {
  generation: IntegratorPipelineGeneration;
  plan: IntegratorPlanWire;
};

/**
 * Full static definition: identity (capabilities hash) + session registration for {@link AgentRegistry.register}.
 */
export async function getMemoryIntegratorAgentDefinition(
  namespace: string,
  options?: DefineMemoryIntegratorIdentityOptions,
): Promise<{
  staticHash: string;
  identity: RegisteredAgent;
  registerOptions: RegisterAgentOptions<
    MemoryIntegratorSessionInput,
    MemoryIntegratorSessionOutput,
    MemoryIntegratorSessionContext<ZodLabelMap, ZodLabelMap>
  >;
}> {
  const { staticHash, identity } = await defineMemoryIntegratorIdentity(namespace, options);
  return {
    staticHash,
    identity,
    registerOptions: {
      run: createMemoryIntegratorSessionRunner<ZodLabelMap, ZodLabelMap>(),
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
 * Registers the memory integrator on {@code registry} if not already present (same agent id for {@code namespace}).
 */
export async function ensureMemoryIntegratorAgentRegistered(
  registry: AgentRegistry,
  namespace: string,
  options?: DefineMemoryIntegratorIdentityOptions,
): Promise<{ staticHash: string; identity: RegisteredAgent }> {
  const id = buildMemoryIntegratorAgentId(namespace);
  if (registry.has(id)) {
    const entry = registry.get(id);
    if (!entry) {
      throw new Error(`registry inconsistency: has(${id}) but get is undefined`);
    }
    return { staticHash: entry.agent.staticHash, identity: entry.agent };
  }
  const { staticHash, identity, registerOptions } = await getMemoryIntegratorAgentDefinition(
    namespace,
    options,
  );
  registry.register(identity, registerOptions);
  return { staticHash, identity };
}

export const registerMemoryIntegratorAgent = ensureMemoryIntegratorAgentRegistered;

export function createMemoryIntegratorSessionRunner<
  TNode extends ZodLabelMap,
  TEdge extends ZodLabelMap,
>(): SessionRunner<
  MemoryIntegratorSessionInput,
  MemoryIntegratorSessionOutput,
  MemoryIntegratorSessionContext<TNode, TEdge>
> {
  return async ({ agent, input, context }) => {
    const { model, client } = context;
    const { content, maxSteps } = input;

    if (!context.toolkitCtx || !context.runtime || !context.affordances) {
      throw new Error(
        "memory integrator session context missing toolkit/runtime/affordances (onAfterContext hook)",
      );
    }

    const integratorAgent = createMemoryIntegratorAgent({
      model,
      identity: agent,
      affordances: context.affordances,
      runtime: context.runtime,
      maxSteps,
      ontology: client.ontology,
    });

    const messages = [buildMemoryIntegratorUserMessage({ content })];
    let generation: IntegratorPipelineGeneration;
    try {
      generation = await integratorAgent.generate({ messages });
    } catch (e) {
      if (NoOutputGeneratedError.isInstance(e) || NoObjectGeneratedError.isInstance(e)) {
        generation = await integratorAgent.generate({ messages });
      } else {
        throw e;
      }
    }

    const raw = generation.output as unknown;
    const plan = parseIntegratorPlanWire(client.ontology, raw);

    return { generation, plan };
  };
}
