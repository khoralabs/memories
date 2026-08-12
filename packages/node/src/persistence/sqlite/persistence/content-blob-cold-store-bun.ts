import { S3Client, type S3Options } from "bun";
import type { ContentBlobColdStore } from "../../core/persistence/content-blob-cold-store";

export type BunS3ContentBlobColdStoreOptions = {
  /** Object key prefix; default `memories/content-blobs/`. */
  prefix?: string;
  /** Explicit bucket (also accepted via `s3.bucket`). */
  bucket?: string;
  /** Bun `S3Client` constructor options (credentials, endpoint, region, bucket). */
  s3?: S3Options;
};

function resolveBucket(options?: BunS3ContentBlobColdStoreOptions): string | undefined {
  const fromOpts =
    options?.bucket?.trim() ||
    (typeof options?.s3?.bucket === "string" ? options.s3.bucket.trim() : "") ||
    "";
  if (fromOpts.length > 0) return fromOpts;
  const fromEnv = process.env.S3_BUCKET?.trim() || process.env.AWS_BUCKET?.trim() || "";
  return fromEnv.length > 0 ? fromEnv : undefined;
}

/**
 * Cold blob store backed by Bun's native S3 API (`S3Client`).
 * Returns `undefined` when no bucket is configured (evacuate is then a no-op
 * unless `allowDropWithoutColdStore: true`).
 */
export function createBunS3ContentBlobColdStore(
  options?: BunS3ContentBlobColdStoreOptions,
): ContentBlobColdStore | undefined {
  const bucket = resolveBucket(options);
  if (bucket === undefined) return undefined;

  const prefix = options?.prefix ?? "memories/content-blobs/";
  const s3 = new S3Client({
    ...(options?.s3 ?? {}),
    bucket,
  });

  return {
    uriFor(contentSha256: string) {
      return `s3://${bucket}/${prefix}${contentSha256}`;
    },
    async put(contentSha256: string, text: string) {
      await s3.file(`${prefix}${contentSha256}`).write(text, {
        type: "text/plain;charset=utf-8",
      });
    },
    async get(contentSha256: string) {
      const file = s3.file(`${prefix}${contentSha256}`);
      if (!(await file.exists())) return null;
      return file.text();
    },
  };
}

/** In-memory cold store for unit tests. */
export function createMemoryContentBlobColdStore(): ContentBlobColdStore & {
  readonly map: Map<string, string>;
} {
  const map = new Map<string, string>();
  return {
    map,
    uriFor(contentSha256: string) {
      return `memory://${contentSha256}`;
    },
    async put(contentSha256: string, text: string) {
      map.set(contentSha256, text);
    },
    async get(contentSha256: string) {
      return map.get(contentSha256) ?? null;
    },
  };
}
