import { describe, expect, test } from "bun:test";
import { sha256Hex } from "../../core/models/sha256";
import {
  createBunS3ContentBlobColdStore,
  createMemoryContentBlobColdStore,
} from "./content-blob-cold-store-bun";

function minioConfig():
  | {
      endpoint: string;
      bucket: string;
      accessKeyId: string;
      secretAccessKey: string;
    }
  | undefined {
  const endpoint = process.env.MINIO_ENDPOINT?.trim() || process.env.S3_ENDPOINT?.trim() || "";
  const bucket =
    process.env.MINIO_BUCKET?.trim() ||
    process.env.S3_BUCKET?.trim() ||
    process.env.AWS_BUCKET?.trim() ||
    "";
  const accessKeyId =
    process.env.MINIO_ACCESS_KEY?.trim() ||
    process.env.S3_ACCESS_KEY_ID?.trim() ||
    process.env.AWS_ACCESS_KEY_ID?.trim() ||
    "";
  const secretAccessKey =
    process.env.MINIO_SECRET_KEY?.trim() ||
    process.env.S3_SECRET_ACCESS_KEY?.trim() ||
    process.env.AWS_SECRET_ACCESS_KEY?.trim() ||
    "";
  if (!(endpoint && bucket && accessKeyId && secretAccessKey)) return undefined;
  return { endpoint, bucket, accessKeyId, secretAccessKey };
}

describe("content blob cold store", () => {
  test("in-memory fake put/get round-trips", async () => {
    const store = createMemoryContentBlobColdStore();
    const sha = sha256Hex("hello-minio-fake");
    await store.put(sha, "hello-minio-fake");
    expect(await store.get(sha)).toBe("hello-minio-fake");
    expect(store.uriFor(sha)).toBe(`memory://${sha}`);
  });
});

describe.skipIf(minioConfig() === undefined)("bun S3 cold store (MinIO)", () => {
  test("put/get round-trip via Bun S3Client", async () => {
    const cfg = minioConfig();
    expect(cfg).toBeDefined();
    if (cfg === undefined) return;

    const store = createBunS3ContentBlobColdStore({
      bucket: cfg.bucket,
      prefix: `memories/content-blobs/test-${Date.now()}/`,
      s3: {
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
        endpoint: cfg.endpoint,
        region: process.env.S3_REGION?.trim() || "us-east-1",
      },
    });
    expect(store).toBeDefined();
    if (store === undefined) return;

    const text = `minio-body-${Date.now()}`;
    const sha = sha256Hex(text);
    await store.put(sha, text);
    const fetched = await store.get(sha);
    expect(fetched).toBe(text);
    expect(fetched === null ? null : sha256Hex(fetched)).toBe(sha);
    expect(store.uriFor(sha)).toContain(cfg.bucket);
    expect(store.uriFor(sha)).toContain(sha);
  });
});
