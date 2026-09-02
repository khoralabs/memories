import type {
  AgentRegistry,
  RegisterAgentOptions,
  RegisteredAgent,
  SessionContext,
  SessionRunner,
} from "@khoralabs/agent-capabilities";
import { type LanguageModel, NoObjectGeneratedError, NoOutputGeneratedError } from "ai";
import {
  buildMemoryInvestigatorAgentId,
  type DefineMemoryInvestigatorIdentityOptions,
  defineMemoryInvestigatorIdentity,
} from "../../investigator/identity.js";
import {
  type InvestigatorAnswerWire,
  parseInvestigatorAnswerWire,
} from "../../investigator/investigator-output.js";
import { buildMemoryInvestigatorUserMessage } from "../../investigator/messages.js";
import {
  attachMemorySearchSessionLayer,
  type MemorySearchSessionContextSlice,
  type ZodLabelMap,
} from "../../tools/toolkit-context.js";
import { toolLoopMemorySearchExecutor } from "../memory-search-agent-executor.js";
import type { InvestigatorPipelineGeneration } from "./create-investigator-agent.js";
import { buildMemoryInvestigatorAgentSpec } from "./create-investigator-agent.js";

export type MemoryInvestigatorSessionContext<
  TNode extends ZodLabelMap,
  TEdge extends ZodLabelMap,
> = SessionContext &
  MemorySearchSessionContextSlice<TNode, TEdge> & {
    model: LanguageModel;
  };

export type MemoryInvestigatorSessionInput = {
  question: string;
  maxSteps: number;
};

export type MemoryInvestigatorSessionOutput = {
  generation: InvestigatorPipelineGeneration;
  answer: InvestigatorAnswerWire;
};

export async function getMemoryInvestigatorAgentDefinition(
  primaryNamespace: string,
  options?: DefineMemoryInvestigatorIdentityOptions,
): Promise<{
  staticHash: string;
  identity: RegisteredAgent;
  registerOptions: RegisterAgentOptions<
    MemoryInvestigatorSessionInput,
    MemoryInvestigatorSessionOutput,
    MemoryInvestigatorSessionContext<ZodLabelMap, ZodLabelMap>
  >;
}> {
  const { staticHash, identity } = await defineMemoryInvestigatorIdentity(
    primaryNamespace,
    options,
  );
  return {
    staticHash,
    identity,
    registerOptions: {
      run: createMemoryInvestigatorSessionRunner<ZodLabelMap, ZodLabelMap>(),
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

export async function ensureMemoryInvestigatorAgentRegistered(
  registry: AgentRegistry,
  primaryNamespace: string,
  options?: DefineMemoryInvestigatorIdentityOptions,
): Promise<{ staticHash: string; identity: RegisteredAgent }> {
  const id = await buildMemoryInvestigatorAgentId({
    primaryNamespace,
    additionalNamespaces: options?.additionalNamespaces,
    extraToolMembers: options?.extraToolMembers,
  });
  if (registry.has(id)) {
    const entry = registry.get(id);
    if (!entry) {
      throw new Error(`registry inconsistency: has(${id}) but get is undefined`);
    }
    return { staticHash: entry.agent.staticHash, identity: entry.agent };
  }
  const { staticHash, identity, registerOptions } = await getMemoryInvestigatorAgentDefinition(
    primaryNamespace,
    options,
  );
  registry.register(identity, registerOptions);
  return { staticHash, identity };
}

export const registerMemoryInvestigatorAgent = ensureMemoryInvestigatorAgentRegistered;

export function createMemoryInvestigatorSessionRunner<
  TNode extends ZodLabelMap,
  TEdge extends ZodLabelMap,
>(): SessionRunner<
  MemoryInvestigatorSessionInput,
  MemoryInvestigatorSessionOutput,
  MemoryInvestigatorSessionContext<TNode, TEdge>
> {
  return async ({ agent, input, context }) => {
    const { model } = context;
    const { question, maxSteps } = input;

    if (!context.toolkitCtx || !context.runtime || !context.affordances) {
      throw new Error(
        "memory investigator session context missing toolkit/runtime/affordances (onAfterContext hook)",
      );
    }

    const executor = context.executor ?? toolLoopMemorySearchExecutor;
    const spec = buildMemoryInvestigatorAgentSpec({
      model,
      identity: agent,
      affordances: context.affordances,
      runtime: context.runtime,
      maxSteps,
    });

    const messages = [buildMemoryInvestigatorUserMessage({ question })];
    const runOpts = {
      messages,
      ...(context.abortSignal ? { abortSignal: context.abortSignal } : {}),
    };
    let generation: InvestigatorPipelineGeneration;
    try {
      generation = await executor.run(spec, runOpts);
    } catch (e) {
      if (NoOutputGeneratedError.isInstance(e) || NoObjectGeneratedError.isInstance(e)) {
        generation = await executor.run(spec, runOpts);
      } else {
        throw e;
      }
    }

    const answer = parseInvestigatorAnswerWire(generation.output as unknown);

    return { generation, answer };
  };
}
