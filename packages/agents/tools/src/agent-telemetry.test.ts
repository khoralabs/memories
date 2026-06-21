import { describe, expect, test } from "bun:test";
import type { AgentTelemetry } from "@khoralabs/agent-capabilities-otel";

import { MEMORIES_PROVENANCE_ROOT_HEX_ATTR, memoryAgentSessionHooks } from "./agent-telemetry.js";

function mockTelemetry() {
  const attrs: Record<string, string | number | boolean> = {};
  const events: { name: string; attrs?: Record<string, string | number | boolean> }[] = [];
  const flags = { started: false, afterContext: false };

  const telemetry: AgentTelemetry = {
    sessionHooks: {
      onStart: async () => {
        flags.started = true;
      },
      onAfterContext: async () => {
        flags.afterContext = true;
      },
    },
    pipelineHooks: {},
    linkCapabilityLink: () => {},
    linkCapture: () => {},
    setSessionAttributes: (next) => {
      Object.assign(attrs, next);
    },
    addSessionEvent: (name, next) => {
      events.push({ name, attrs: next });
    },
    traceAffordanceEvaluation: async (fn) => fn(),
  };

  return { telemetry, attrs, events, flags };
}

describe("memoryAgentSessionHooks", () => {
  test("sets provenance head on session start and after context", async () => {
    const { telemetry, attrs, events, flags } = mockTelemetry();
    const client = {
      persistence: {
        getProvenanceHeadRootHex: () => "abc123deadbeef",
      },
    };

    const hooks = await memoryAgentSessionHooks({ client, telemetry });
    await hooks.onStart?.({
      agent: { agentId: "a", name: "n", staticHash: "h" } as never,
      input: {},
    });
    await hooks.onAfterContext?.({
      agent: { agentId: "a", name: "n", staticHash: "h" } as never,
      input: {},
      context: { memoriesSnapshotRootHex: "contexthex" },
    });

    expect(flags.started).toBe(true);
    expect(flags.afterContext).toBe(true);
    expect(attrs[MEMORIES_PROVENANCE_ROOT_HEX_ATTR]).toBe("contexthex");
    expect(events.at(-1)).toEqual({
      name: "memories.provenance_snapshot",
      attrs: { [MEMORIES_PROVENANCE_ROOT_HEX_ATTR]: "contexthex" },
    });
  });

  test("uses empty string when provenance chain is empty", async () => {
    const { telemetry, attrs } = mockTelemetry();
    const hooks = await memoryAgentSessionHooks({
      client: { persistence: { getProvenanceHeadRootHex: () => undefined } },
      telemetry,
    });
    await hooks.onStart?.({
      agent: { agentId: "a", name: "n", staticHash: "h" } as never,
      input: {},
    });
    expect(attrs[MEMORIES_PROVENANCE_ROOT_HEX_ATTR]).toBe("");
  });
});
