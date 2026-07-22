/** Structured log payloads for hybrid memory search toolkit and text embedding. */

type MemoriesTelemetryContext = {
  /** Store provenance chain head at event time (`memory_provenance.root_hex`, or `""` when empty). */
  memoriesProvenanceRootHex: string;
};

export type MemoriesLogPayloadMap = {
  "memories.toolkit.toolCall": MemoriesTelemetryContext & {
    processTimeMs: number;
    toolName: string;
    ok: boolean;
    input?: unknown;
    outputSummary?: { hitCount: number; memoryKeys: string[] };
    error?: unknown;
  };
  "memories.toolkit.memory_search": MemoriesTelemetryContext & {
    processTimeMs: number;
    embedMs: number;
    searchMs: number;
    embedCacheHit: boolean;
    hitCount: number;
  };
  "memories.embed.textChunks": MemoriesTelemetryContext & {
    processTimeMs: number;
    textCount: number;
    model: string;
  };
};

export function memoriesLog<P extends keyof MemoriesLogPayloadMap>(
  phase: P,
  payload: MemoriesLogPayloadMap[P],
): { phase: P } & MemoriesLogPayloadMap[P] {
  return { phase, ...payload };
}

const TRUTHY = new Set(["1", "true", "yes"]);

/**
 * When set, full `content.text` is included in `memories.toolkit.toolCall` logs (default: truncated preview only).
 * Checks `MEMORIES_LOG_TOOL_BODIES`.
 */
export function memoriesLogToolBodies(): boolean {
  const v = process.env.MEMORIES_LOG_TOOL_BODIES?.trim().toLowerCase();
  return Boolean(v && TRUTHY.has(v));
}
