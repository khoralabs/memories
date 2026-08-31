import type { ContentBlobColdStore } from "../persistence/content-blob-cold-store";

/** Tip replay stream; each facet has its own LWW key dimensions. */
export type TipOutboxFacet = "content" | "graph" | "vector" | "provenance";

export type TipOutboxEventType =
  | "MERGE_MEMORY"
  | "DELETE_MEMORY"
  | "SUPPRESS_MEMORY"
  | "UNSUPPRESS_MEMORY"
  | "RENAME_NAMESPACE"
  | "SUPPRESS_NAMESPACE"
  | "UNSUPPRESS_NAMESPACE";

export type TipOutboxKeys = {
  namespace?: string;
  memoryKey?: string;
  sourceKey?: string;
  edgeId?: string;
};

export type TipOutboxAppendInput = {
  rootHex: string;
  facet: TipOutboxFacet;
  eventType: TipOutboxEventType;
  keys: TipOutboxKeys;
  /** Payload bytes; stored content-addressed in tip blobs. */
  payload?: Uint8Array;
  now: number;
  rowId: string;
};

export type TipOutboxLwwRow = {
  facet: TipOutboxFacet;
  namespace: string;
  memoryKey: string;
  sourceKey: string | null;
  edgeId: string | null;
  payloadSha256: string | null;
  blobBytes: Uint8Array | null;
  blobText: string | null;
  location: string | null;
  coldUri: string | null;
};

export type TipOutboxReplayScope = {
  facet: TipOutboxFacet;
  namespace?: string;
  memoryKey?: string;
  edgeId?: string;
};

export type TipOutboxSqlDeps = {
  queryAll<T extends Record<string, unknown>>(sql: string, params: unknown[]): Promise<T[]>;
  exec(sql: string, params: unknown[]): Promise<void>;
  coldStore?: ContentBlobColdStore;
  isClosedDatabaseError?(err: unknown): boolean;
};
