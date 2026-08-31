/**
 * Optional cold tier for content-addressed text blobs outside the hot tip window.
 * When unset, evacuate is a no-op by default (hot bodies retained). Pass
 * `allowDropWithoutColdStore: true` on createMemories*Persistence to permanently
 * drop bodies (`location = 'dropped'`) instead.
 */
export type ContentBlobColdStore = {
  put(contentSha256: string, text: string): Promise<void>;
  get(contentSha256: string): Promise<string | null>;
  /** Stable URI/key stored in `memory_tip_blobs.cold_uri`. */
  uriFor(contentSha256: string): string;
};

export type ContentBlobLocation = "hot" | "cold" | "dropped";

/** Default number of newest provenance tips whose blob bodies stay hot in SQLite. */
export const DEFAULT_CONTENT_OUTBOX_RETENTION_TIPS = 256;
