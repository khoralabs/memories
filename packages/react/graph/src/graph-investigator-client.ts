import type { InvestigatorAnswer } from "./graph-investigator-types.js";
import type { ReactMemoriesClient } from "./memories-client.js";

export type GraphInvestigatorSession = {
  cancel: () => void;
};

export type GraphInvestigatorClientCallbacks = {
  onProgress: (message: string) => void;
  onComplete: (answer: InvestigatorAnswer) => void;
  onError: (error: string) => void;
};

export type GraphInvestigatorClient = {
  startInvestigation(
    input: { namespace: string; question: string },
    callbacks: GraphInvestigatorClientCallbacks,
  ): GraphInvestigatorSession;
};

export type JobStreamInvestigationEvent =
  | { type: "progress"; message: string }
  | { type: "complete"; answer: InvestigatorAnswer }
  | { type: "error"; error: string };

export type CreateSyncInvestigatorClientOptions = {
  client: ReactMemoriesClient;
  progressMessage?: string;
};

/** Await a synchronous investigate answer via {@link ReactMemoriesClient.investigate}. */
export function createSyncInvestigatorClient(
  options: CreateSyncInvestigatorClientOptions,
): GraphInvestigatorClient {
  const progressMessage = options.progressMessage ?? "Investigating…";
  const client = options.client;

  return {
    startInvestigation(input, callbacks) {
      const controller = new AbortController();
      void (async () => {
        try {
          if (client.investigate === undefined) {
            callbacks.onError("ReactMemoriesClient.investigate is not implemented");
            return;
          }
          callbacks.onProgress(progressMessage);
          const answer = await client.investigate({
            namespace: input.namespace,
            question: input.question,
            signal: controller.signal,
          });
          if (controller.signal.aborted) return;
          callbacks.onComplete(answer);
        } catch (err) {
          if (controller.signal.aborted) return;
          callbacks.onError(String(err));
        }
      })();

      return { cancel: () => controller.abort() };
    },
  };
}

/** Start an async job, stream progress over SSE, optionally cancel via HTTP. */
export function createJobStreamInvestigatorClient(options: {
  startJob: (input: { namespace: string; question: string }) => Promise<{ jobId: string }>;
  streamUrl: (jobId: string) => string;
  parseEvent: (data: string) => JobStreamInvestigationEvent | null;
  fetchCompleteAnswer?: (jobId: string) => Promise<InvestigatorAnswer | null | undefined>;
  cancelJob?: (jobId: string) => void | Promise<void>;
  credentials?: RequestCredentials;
  initialProgressMessage?: string;
}): GraphInvestigatorClient {
  const initialProgressMessage = options.initialProgressMessage ?? "Starting investigation…";

  return {
    startInvestigation(input, callbacks) {
      let jobId: string | null = null;
      let source: EventSource | null = null;
      let cancelled = false;
      let completed = false;

      const cleanup = () => {
        if (source !== null) {
          source.close();
          source = null;
        }
      };

      const finishComplete = (answer: InvestigatorAnswer) => {
        if (cancelled || completed) return;
        completed = true;
        cleanup();
        callbacks.onComplete(answer);
      };

      const finishError = (message: string) => {
        if (cancelled || completed) return;
        cleanup();
        callbacks.onError(message);
      };

      const recoverFromJob = async (): Promise<boolean> => {
        if (cancelled || completed || jobId === null || options.fetchCompleteAnswer === undefined) {
          return false;
        }
        try {
          const answer = await options.fetchCompleteAnswer(jobId);
          if (answer !== null && answer !== undefined) {
            finishComplete(answer);
            return true;
          }
        } catch {
          // fall through
        }
        return false;
      };

      void (async () => {
        try {
          callbacks.onProgress(initialProgressMessage);
          const started = await options.startJob(input);
          if (cancelled) return;

          jobId = started.jobId;
          source = new EventSource(options.streamUrl(jobId), {
            withCredentials: options.credentials !== "omit",
          });

          source.onmessage = (event) => {
            const parsed = options.parseEvent(event.data);
            if (parsed === null) return;

            if (parsed.type === "progress") {
              callbacks.onProgress(parsed.message);
              return;
            }

            if (parsed.type === "error") {
              finishError(parsed.error);
              return;
            }

            if (parsed.type === "complete") {
              finishComplete(parsed.answer);
            }
          };

          source.onerror = () => {
            if (cancelled || completed) return;
            setTimeout(() => {
              void (async () => {
                if (cancelled || completed) return;
                const recovered = await recoverFromJob();
                if (recovered || cancelled || completed) return;
                finishError("Investigation stream failed");
              })();
            }, 150);
          };
        } catch (err) {
          if (cancelled) return;
          cleanup();
          callbacks.onError(String(err));
        }
      })();

      return {
        cancel: () => {
          cancelled = true;
          cleanup();
          if (jobId !== null && options.cancelJob !== undefined) {
            void options.cancelJob(jobId);
          }
        },
      };
    },
  };
}
