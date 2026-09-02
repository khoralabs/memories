/**
 * Framework-free agent run result (no AI SDK types).
 * Executors may put opaque model/tool messages in {@link messages}.
 */
export type MemorySearchAgentRunResult<TOutput = unknown> = {
  output: TOutput;
  /** Agent-produced messages (model + tool turns), excluding the input prompt. */
  messages: unknown[];
  /** For error messages / telemetry; optional for workflow runs. */
  stepCount?: number;
  finishReason?: string;
};

/** Portable user/system message for memory-search agent runs. */
export type MemorySearchAgentMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

/**
 * Host-supplied runner for memory-search agent loops.
 * Spec shape is intentionally opaque so AI SDK / Workflow adapters can use their own types.
 */
export type MemorySearchAgentExecutor = {
  run(
    spec: unknown,
    opts: { messages: MemorySearchAgentMessage[]; abortSignal?: AbortSignal },
  ): Promise<MemorySearchAgentRunResult>;
};
