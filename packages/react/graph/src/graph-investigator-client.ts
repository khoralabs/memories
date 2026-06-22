import type { InvestigatorAnswer } from "./graph-investigator-types.js";

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

/** POST investigate and await a synchronous JSON answer (legacy / in-process backends). */
export function createSyncInvestigatorClient(options: {
  investigateUrl: string;
  credentials?: RequestCredentials;
  progressMessage?: string;
}): GraphInvestigatorClient {
  const progressMessage = options.progressMessage ?? "Investigating…";

  return {
    startInvestigation(input, callbacks) {
      const controller = new AbortController();
      void (async () => {
        try {
          callbacks.onProgress(progressMessage);
          const res = await fetch(options.investigateUrl, {
            method: "POST",
            credentials: options.credentials ?? "include",
            signal: controller.signal,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ namespace: input.namespace, question: input.question }),
          });
          const json = (await res.json()) as InvestigatorAnswer & { error?: string };
          if (controller.signal.aborted) return;
          if (!res.ok || json.error) {
            callbacks.onError(json.error ?? res.statusText);
            return;
          }
          callbacks.onComplete({
            answer: json.answer,
            ...(json.citations !== undefined ? { citations: json.citations } : {}),
            ...(json.follow_up_queries !== undefined
              ? { follow_up_queries: json.follow_up_queries }
              : {}),
          });
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
              cleanup();
              callbacks.onError(parsed.error);
              return;
            }

            if (parsed.type === "complete") {
              completed = true;
              cleanup();
              callbacks.onComplete(parsed.answer);
            }
          };

          source.onerror = () => {
            if (cancelled || jobId === null || completed) return;
            cleanup();
            callbacks.onError("Investigation stream failed");
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
