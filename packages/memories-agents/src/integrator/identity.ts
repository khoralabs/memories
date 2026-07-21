import { createRegisteredAgent, type RegisteredAgent } from "@khoralabs/agent-capabilities";
import { memorySearchToolkit } from "../tools/index";
import { memoryIntegratorBaseInstruction } from "./instructions.js";

export const MEMORY_INTEGRATOR_AGENT_ID = "memory-integrator";

export function buildMemoryIntegratorAgentId(namespace: string): string {
  return `${MEMORY_INTEGRATOR_AGENT_ID}-${namespace}`;
}

export type DefineMemoryIntegratorIdentityOptions = {
  /** Merged into \`createRegisteredAgent\` context. */
  identityContext?: Record<string, unknown>;
  /** Additional static instruction blocks prepended before the integrator base instruction. */
  instructions?: string[];
};

/**
 * Static agent identity: memory search toolkit + integrator instructions (structured MemoryIntegratorPlan).
 */
export async function defineMemoryIntegratorIdentity(
  namespace: string,
  options?: DefineMemoryIntegratorIdentityOptions,
): Promise<{ staticHash: string; identity: RegisteredAgent }> {
  const { staticHash, agent } = await createRegisteredAgent({
    agentId: buildMemoryIntegratorAgentId(namespace),
    name: "Memory Integrator",
    instructions: [...(options?.instructions ?? []), memoryIntegratorBaseInstruction],
    context: {
      role: "memory-integrator",
      targetNamespace: namespace,
      ...(options?.identityContext ?? {}),
    },
    rootComposable: memorySearchToolkit,
  });
  return { staticHash, identity: agent };
}
