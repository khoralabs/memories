import { createRegisteredAgent, type RegisteredAgent } from "@khoralabs/agent-capabilities";
import { memorySearchToolkit } from "../tools/index";
import { memoryAdapterBaseInstruction } from "./instructions.js";

export const MEMORY_ADAPTER_AGENT_ID = "memory-adapter";

export function buildMemoryAdapterAgentId(namespace: string): string {
  return `${MEMORY_ADAPTER_AGENT_ID}-${namespace}`;
}

export type DefineMemoryAdapterIdentityOptions = {
  /** Merged into \`createRegisteredAgent\` context (deployment / tenant / product vocabulary). */
  identityContext?: Record<string, unknown>;
  /** Additional static instruction blocks prepended before the adapter base instruction. */
  instructions?: string[];
};

/**
 * Static agent identity for the memory adapter (same hybrid search toolkit as the librarian for retrieval).
 */
export async function defineMemoryAdapterIdentity(
  namespace: string,
  options?: DefineMemoryAdapterIdentityOptions,
): Promise<{ staticHash: string; identity: RegisteredAgent }> {
  const { staticHash, agent } = await createRegisteredAgent({
    agentId: buildMemoryAdapterAgentId(namespace),
    name: "Memory Adapter",
    instructions: [...(options?.instructions ?? []), memoryAdapterBaseInstruction],
    context: {
      role: "memory-adapter",
      targetNamespace: namespace,
      ...(options?.identityContext ?? {}),
    },
    rootComposable: memorySearchToolkit,
  });
  return { staticHash, identity: agent };
}
