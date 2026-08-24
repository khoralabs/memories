import type {
  AgentRegistry,
  RegisterAgentOptions,
  RegisteredAgent,
  SessionContext,
  SessionRunner,
} from "@khoralabs/agent-capabilities";
import {
  generateObject,
  type LanguageModel,
  type ModelMessage,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
} from "ai";
import {
  attachMemorySearchSessionLayer,
  type MemorySearchAgentRunResult,
  type MemorySearchSessionContextSlice,
  toolLoopMemorySearchExecutor,
  type ZodLabelMap,
} from "../tools/index";
import type {
  IntegratorPlanGeneration,
  IntegratorSearchGeneration,
} from "./create-integrator-agent.js";
import { buildMemoryIntegratorSearchAgentSpec } from "./create-integrator-agent.js";
import {
  buildMemoryIntegratorAgentId,
  type DefineMemoryIntegratorIdentityOptions,
  defineMemoryIntegratorIdentity,
} from "./identity.js";
import { memoryIntegratorPlanPhaseInstruction } from "./instructions.js";
import {
  type IntegratorPlanWire,
  parseIntegratorPlanWire,
  zIntegratorPlanWire,
} from "./integrator-output.js";
import {
  buildMemoryIntegratorPlanUserMessage,
  buildMemoryIntegratorUserMessage,
} from "./messages.js";

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
  searchGeneration: IntegratorSearchGeneration;
  planGeneration: IntegratorPlanGeneration;
  /** Plan-phase generation (backward compatible alias). */
  generation: IntegratorPlanGeneration;
  plan: IntegratorPlanWire;
  discoveredMemoryKeys: string[];
};

/** Merge search-phase user prompt with agent-produced messages for the plan phase. */
export function mergeSearchPhaseMessages(
  userMessage: ModelMessage,
  searchResult: MemorySearchAgentRunResult,
): ModelMessage[] {
  return [userMessage, ...searchResult.messages];
}

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
            trackDiscoveredMemoryKeys: true,
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

    const executor = context.executor ?? toolLoopMemorySearchExecutor;
    const spec = buildMemoryIntegratorSearchAgentSpec({
      model,
      identity: agent,
      affordances: context.affordances,
      runtime: context.runtime,
      maxSteps,
    });

    const userMessage = buildMemoryIntegratorUserMessage({ content });
    const searchRunOpts = {
      messages: [userMessage],
      ...(context.abortSignal ? { abortSignal: context.abortSignal } : {}),
    };

    let searchGeneration: IntegratorSearchGeneration;
    try {
      searchGeneration = await executor.run(spec, searchRunOpts);
    } catch (e) {
      if (NoOutputGeneratedError.isInstance(e) || NoObjectGeneratedError.isInstance(e)) {
        searchGeneration = await executor.run(spec, searchRunOpts);
      } else {
        throw e;
      }
    }

    const discoveredMemoryKeys = [...(context.runtime.env.discoveredMemoryKeys ?? [])].sort(
      (a, b) => a.localeCompare(b),
    );

    const planSchema = zIntegratorPlanWire(client.ontology, {
      allowedMemoryKeys: discoveredMemoryKeys,
    });
    const planSystem = [
      context.affordances.instructions.trim(),
      memoryIntegratorPlanPhaseInstruction,
    ]
      .filter((s) => s.length > 0)
      .join("\n\n");
    const planMessages = [
      ...mergeSearchPhaseMessages(userMessage, searchGeneration),
      buildMemoryIntegratorPlanUserMessage({ allowedMemoryKeys: discoveredMemoryKeys }),
    ];
    const planGenerateOpts = {
      model,
      schema: planSchema,
      system: planSystem,
      messages: planMessages,
      ...(context.abortSignal ? { abortSignal: context.abortSignal } : {}),
    };

    let planGeneration: IntegratorPlanGeneration;
    try {
      planGeneration = await generateObject(planGenerateOpts);
    } catch (e) {
      if (NoOutputGeneratedError.isInstance(e) || NoObjectGeneratedError.isInstance(e)) {
        planGeneration = await generateObject(planGenerateOpts);
      } else {
        throw e;
      }
    }

    const plan = parseIntegratorPlanWire(client.ontology, planGeneration.object, {
      allowedMemoryKeys: discoveredMemoryKeys,
    });

    return {
      searchGeneration,
      planGeneration,
      generation: planGeneration,
      plan,
      discoveredMemoryKeys,
    };
  };
}
