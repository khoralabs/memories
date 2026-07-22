import type { MemoriesDatabaseId } from "./database-id";

export type MemoriesDatabaseSnapshot = {
  id: MemoriesDatabaseId;
  body: ReadableStream<Uint8Array>;
  contentType: string;
  contentLength?: number;
  contentEncoding?: string;
  filename?: string;
  metadata?: Record<string, string>;
};

export class UnsupportedStorageFeatureError extends Error {
  constructor(
    readonly feature: string,
    readonly backendKind?: string,
  ) {
    super(
      backendKind === undefined
        ? `Storage feature is unsupported: ${feature}`
        : `Storage feature is unsupported by ${backendKind}: ${feature}`,
    );
    this.name = "UnsupportedStorageFeatureError";
  }
}

export function unsupportedStorageFeature(feature: string, backendKind?: string): never {
  throw new UnsupportedStorageFeatureError(feature, backendKind);
}
