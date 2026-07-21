import type { ProviderOptions } from "@ai-sdk/provider-utils";
import { type EmbeddingModel as AiSdkEmbeddingModel, embed, embedMany } from "ai";

export type { ProviderOptions } from "@ai-sdk/provider-utils";
export type { EmbeddingModel as AiSdkEmbeddingModel } from "ai";

/** Required embedding model when multimodal file embedding is enabled. */
export const MULTIMODAL_REQUIRED_EMBEDDING_MODEL_ID = "gemini-embedding-2-preview";

export const DEFAULT_EMBED_TEXT_BATCH_SIZE = 100;
export const MAX_TEXT_CHUNK_CHARS = 2_000;

/**
 * Common output dimensionalities for Google Generative AI embedding models
 * (`providerOptions.google.outputDimensionality`).
 */
export const EMBEDDING_OUTPUT_DIMENSIONALITY = {
  L: 768,
  M: 1536,
  H: 3072,
} as const;

export type EmbeddingResolutionPreset = keyof typeof EMBEDDING_OUTPUT_DIMENSIONALITY;

/** Maps a resolution preset to AI SDK `providerOptions` for Google embeddings. */
export function embedConfigForResolutionPreset(preset: EmbeddingResolutionPreset): ProviderOptions {
  return { google: { outputDimensionality: EMBEDDING_OUTPUT_DIMENSIONALITY[preset] } };
}

export function aiSdkEmbeddingModelId(m: AiSdkEmbeddingModel): string {
  if (typeof m === "string") {
    const s = m.trim();
    const slash = s.lastIndexOf("/");
    return slash >= 0 ? s.slice(slash + 1) : s;
  }
  if (
    typeof m === "object" &&
    m !== null &&
    "modelId" in m &&
    typeof (m as { modelId: unknown }).modelId === "string"
  ) {
    return (m as { modelId: string }).modelId;
  }
  return "";
}

export function assertMultimodalEmbeddingModel(m: AiSdkEmbeddingModel): void {
  const id = aiSdkEmbeddingModelId(m);
  if (id !== MULTIMODAL_REQUIRED_EMBEDDING_MODEL_ID) {
    throw new Error(
      `multimodal embedding requires model "${MULTIMODAL_REQUIRED_EMBEDDING_MODEL_ID}", got "${id || "(unknown)"}"`,
    );
  }
}

function mergeProviderOptions(
  ...parts: (ProviderOptions | undefined)[]
): ProviderOptions | undefined {
  let acc: ProviderOptions | undefined;
  for (const p of parts) {
    if (!p) continue;
    if (!acc) {
      acc = { ...p };
      continue;
    }
    const out: Record<string, unknown> = { ...acc };
    for (const [k, v] of Object.entries(p)) {
      const ak = out[k];
      if (
        ak &&
        v &&
        typeof ak === "object" &&
        typeof v === "object" &&
        !Array.isArray(ak) &&
        !Array.isArray(v)
      ) {
        out[k] = { ...(ak as Record<string, unknown>), ...(v as Record<string, unknown>) };
      } else {
        out[k] = v;
      }
    }
    acc = out as ProviderOptions;
  }
  return acc;
}

/** Merge resolution preset with optional extra `providerOptions` for {@link createMemoriesEmbeddingModel}. */
export function mergeResolutionAndProviderOptions(
  resolution: EmbeddingResolutionPreset,
  extra?: ProviderOptions,
): ProviderOptions | undefined {
  return mergeProviderOptions(embedConfigForResolutionPreset(resolution), extra);
}

export interface EmbeddingModel {
  readonly model: AiSdkEmbeddingModel;
  readonly textBatchSize: number;
  readonly maxParallelCalls?: number;
  readonly providerOptions?: ProviderOptions;
}

/**
 * Build an {@link EmbeddingModel} around any [AI SDK embedding model](https://ai-sdk.dev/docs/ai-sdk-core/embeddings#embedding-providers--models).
 */
export function createMemoriesEmbeddingModel(options: {
  model: AiSdkEmbeddingModel;
  textBatchSize?: number;
  maxParallelCalls?: number;
  providerOptions?: ProviderOptions;
}): EmbeddingModel {
  return {
    model: options.model,
    textBatchSize: options.textBatchSize ?? DEFAULT_EMBED_TEXT_BATCH_SIZE,
    ...(options.maxParallelCalls !== undefined
      ? { maxParallelCalls: options.maxParallelCalls }
      : {}),
    ...(options.providerOptions !== undefined ? { providerOptions: options.providerOptions } : {}),
  };
}

export interface BinaryEmbedInput {
  blob: Blob;
  mimeType: string;
  retrievalText: string;
  providerOptions?: ProviderOptions;
}

/**
 * `providerOptions` fragment for Google multimodal embedding: one file part alongside the text {@link embed} `value`.
 */
export function googleGenerativeAiBinaryEmbedContentOptions(input: {
  mimeType: string;
  base64: string;
}): ProviderOptions {
  return {
    google: {
      content: [[{ inlineData: { mimeType: input.mimeType, data: input.base64 } }]],
    },
  };
}

export async function embedTextChunks(
  embeddingModel: EmbeddingModel,
  texts: readonly string[],
  callOptions?: { providerOptions?: ProviderOptions; abortSignal?: AbortSignal },
): Promise<number[][]> {
  if (texts.length === 0) return [];

  const mergedBase = mergeProviderOptions(
    embeddingModel.providerOptions,
    callOptions?.providerOptions,
  );
  const out: number[][] = [];
  const { textBatchSize, maxParallelCalls, model } = embeddingModel;

  for (let batchStart = 0; batchStart < texts.length; batchStart += textBatchSize) {
    const batch = texts.slice(batchStart, batchStart + textBatchSize);
    const { embeddings } = await embedMany({
      model,
      values: [...batch],
      maxParallelCalls,
      providerOptions: mergedBase,
      abortSignal: callOptions?.abortSignal,
    });
    if (embeddings.length !== batch.length) {
      throw new Error(`embedMany: expected ${batch.length} embeddings, got ${embeddings.length}`);
    }
    out.push(...embeddings);
  }

  return out;
}

export async function embedBinaryBlob(
  embeddingModel: EmbeddingModel,
  input: BinaryEmbedInput,
  callOptions?: { providerOptions?: ProviderOptions; abortSignal?: AbortSignal },
): Promise<number[]> {
  const fileBase64 = Buffer.from(await input.blob.arrayBuffer()).toString("base64");
  const multimodal = googleGenerativeAiBinaryEmbedContentOptions({
    mimeType: input.mimeType,
    base64: fileBase64,
  });
  const { embedding } = await embed({
    model: embeddingModel.model,
    value: input.retrievalText,
    providerOptions: mergeProviderOptions(
      embeddingModel.providerOptions,
      multimodal,
      input.providerOptions,
      callOptions?.providerOptions,
    ),
    abortSignal: callOptions?.abortSignal,
  });
  if (!embedding?.length) {
    throw new Error("embed: no embedding vector returned");
  }
  return embedding;
}
