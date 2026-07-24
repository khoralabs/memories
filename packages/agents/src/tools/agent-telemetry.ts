import type { AgentSessionHooks } from "@khoralabs/agent-capabilities";
import {
  type AgentTelemetry,
  type AgentTelemetryOptions,
  createAgentTelemetry,
} from "@khoralabs/agent-capabilities-otel";
import { MEMORIES_PROVENANCE_ROOT_HEX_ATTR as NODE_PROVENANCE_ATTR } from "@khoralabs/memories-node/telemetry";

import { getMemoriesProvenanceHeadRootHex } from "./toolkit-context.js";

/** OTel span attribute for the store provenance chain head (`memory_provenance.root_hex`). */
export const MEMORIES_PROVENANCE_ROOT_HEX_ATTR = NODE_PROVENANCE_ATTR;

/** Pino binding field for the same value (matches {@link memorySearchIdentityLinkSupplement}). */
export const MEMORIES_PROVENANCE_ROOT_HEX_LOG_FIELD = "memoriesProvenanceRootHex" as const;

type MemoriesClientLike = Parameters<typeof getMemoriesProvenanceHeadRootHex>[0];

function applyMemoriesProvenanceToTelemetry(telemetry: AgentTelemetry, rootHex: string): void {
  telemetry.setSessionAttributes({ [MEMORIES_PROVENANCE_ROOT_HEX_ATTR]: rootHex });
  telemetry.addSessionEvent("memories.provenance_snapshot", {
    [MEMORIES_PROVENANCE_ROOT_HEX_ATTR]: rootHex,
  });
}

function provenanceRootHexFromContext(context: unknown, fallback: string): string {
  const hex = (context as { memoriesSnapshotRootHex?: string }).memoriesSnapshotRootHex;
  return hex ?? fallback;
}

/**
 * Layer {@link AgentTelemetry.sessionHooks} with the current memories store provenance head
 * on session start and after context merge (when {@link attachMemorySearchSessionLayer} runs).
 */
export async function memoryAgentSessionHooks(args: {
  client: MemoriesClientLike;
  telemetry: AgentTelemetry;
}): Promise<AgentSessionHooks> {
  const initialHex = (await getMemoriesProvenanceHeadRootHex(args.client)) ?? "";
  const base = args.telemetry.sessionHooks;

  return {
    onBeforeContext: base.onBeforeContext,
    onBeforeRun: base.onBeforeRun,
    onAfterRun: base.onAfterRun,
    onError: base.onError,
    async onStart(hookArgs) {
      await base.onStart?.(hookArgs);
      applyMemoriesProvenanceToTelemetry(args.telemetry, initialHex);
    },
    async onAfterContext(hookArgs) {
      await base.onAfterContext?.(hookArgs);
      applyMemoriesProvenanceToTelemetry(
        args.telemetry,
        provenanceRootHexFromContext(hookArgs.context, initialHex),
      );
    },
  };
}

/**
 * Factory for hosts: binds provenance head into Pino logs and returns telemetry for
 * {@link memoryAgentSessionHooks} when passed to memories agent clients.
 */
export async function createMemoriesAgentTelemetry(
  options: AgentTelemetryOptions & { client: MemoriesClientLike },
): Promise<AgentTelemetry> {
  const { client, logger, ...rest } = options;
  const rootHex = (await getMemoriesProvenanceHeadRootHex(client)) ?? "";
  const boundLogger =
    logger?.child({ [MEMORIES_PROVENANCE_ROOT_HEX_LOG_FIELD]: rootHex }) ?? logger;
  return createAgentTelemetry({ ...rest, logger: boundLogger });
}
