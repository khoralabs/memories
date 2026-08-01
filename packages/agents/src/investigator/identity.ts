import {
  type AnyComposable,
  createRegisteredAgent,
  type RegisteredAgent,
  toolkit,
} from "@khoralabs/agent-capabilities";
import { memorySearchToolkit } from "../tools/index";
import { memoryInvestigatorBaseInstruction } from "./instructions.js";

async function sha256HexPrefix(value: string, hexChars: number): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, hexChars);
}

export const MEMORY_INVESTIGATOR_AGENT_ID = "memory-investigator";

export type DefineMemoryInvestigatorIdentityOptions = {
  /** Merged into `createRegisteredAgent` context. */
  identityContext?: Record<string, unknown>;
  /** Additional static instruction blocks prepended before the investigator base instruction. */
  instructions?: string[];
  /** Extra subtree roots merged with `primaryNamespace` for every `memory_search`. */
  additionalNamespaces?: readonly string[];
  /** Optional composables merged after `memory_search` (same session env; use `memorySearchExtensions` for host state). */
  extraToolMembers?: readonly AnyComposable[];
};

/**
 * Stable agent id from primary namespace, optional additional namespaces, and optional extra tool composables.
 */
export async function buildMemoryInvestigatorAgentId(args: {
  primaryNamespace: string;
  additionalNamespaces?: readonly string[];
  extraToolMembers?: readonly AnyComposable[];
}): Promise<string> {
  const extraHashes =
    args.extraToolMembers && args.extraToolMembers.length > 0
      ? (
          await Promise.all(
            args.extraToolMembers.map(
              async (m) => `${String(m.staticProps.name)}:${await m.computeStaticHash()}`,
            ),
          )
        )
          .sort((a, b) => a.localeCompare(b))
          .join("|")
      : "";
  const nsLine = [args.primaryNamespace, ...(args.additionalNamespaces ?? [])]
    .map((s) => s.trim())
    .filter(Boolean);
  const uniqNs = [...new Set(nsLine)].sort((a, b) => a.localeCompare(b)).join("\n");
  const h = await sha256HexPrefix(`${uniqNs}\n${extraHashes}`, 20);
  return `${MEMORY_INVESTIGATOR_AGENT_ID}-${h}`;
}

/**
 * Static agent identity: `memory_search` plus optional domain toolkits, investigator instructions, structured answer output.
 */
export async function defineMemoryInvestigatorIdentity(
  primaryNamespace: string,
  options?: DefineMemoryInvestigatorIdentityOptions,
): Promise<{ staticHash: string; identity: RegisteredAgent }> {
  const extra = options?.extraToolMembers ?? [];
  const rootComposable = toolkit([memorySearchToolkit, ...extra], {
    name: "memory-investigator-toolkit",
  });
  const agentId = await buildMemoryInvestigatorAgentId({
    primaryNamespace,
    additionalNamespaces: options?.additionalNamespaces,
    extraToolMembers: extra.length > 0 ? extra : undefined,
  });
  const targetNamespaces = [
    ...new Set([primaryNamespace, ...(options?.additionalNamespaces ?? [])]),
  ].sort((a, b) => a.localeCompare(b));
  const { staticHash, agent } = await createRegisteredAgent({
    agentId,
    name: "Memory Investigator",
    instructions: [...(options?.instructions ?? []), memoryInvestigatorBaseInstruction],
    context: {
      role: "memory-investigator",
      primaryNamespace,
      targetNamespaces,
      ...(options?.identityContext ?? {}),
    },
    rootComposable,
  });
  return { staticHash, identity: agent };
}
