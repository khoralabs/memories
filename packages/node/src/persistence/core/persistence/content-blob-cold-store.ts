/**
 * Optional cold tier for content-addressed text blobs outside the hot tip window.
 * When unset, evacuate permanently drops hot blob bodies (`location = 'dropped'`).
 */
export type ContentBlobColdStore = {
  put(contentSha256: string, text: string): Promise<void>;
  get(contentSha256: string): Promise<string | null>;
  /** Stable URI/key stored in `memory_content_blobs.cold_uri`. */
  uriFor(contentSha256: string): string;
};

export type ContentBlobLocation = "hot" | "cold" | "dropped";

/** Default number of newest provenance tips whose blob bodies stay hot in SQLite. */
export const DEFAULT_CONTENT_OUTBOX_RETENTION_TIPS = 256;
