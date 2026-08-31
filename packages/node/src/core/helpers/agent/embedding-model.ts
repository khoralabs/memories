import {
  createMemoriesEmbeddingModel,
  type EmbeddingModel,
  mergeResolutionAndProviderOptions,
} from "@khoralabs/memories-node/helpers";

const DEFAULT_EMBEDDING_MODEL = "google/gemini-embedding-2";

function parseEmbeddingPreset(): "L" | "M" | "H" {
  const raw = process.env.MEMORIES_SEARCH_EMBEDDING_PRESET?.trim().toUpperCase();
  if (raw === "L" || raw === "M" || raw === "H") return raw;
  return "M";
}

function isGoogleEmbeddingModelId(modelId: string): boolean {
  const id = modelId.trim().toLowerCase();
  return id.startsWith("google/") || id.startsWith("gemini-embedding-");
}

/** Resolve agent memory search embedding via AI SDK gateway model id. */
export function resolveAgentEmbeddingModel(): EmbeddingModel | undefined {
  if (!process.env.AI_GATEWAY_API_KEY?.trim()) return undefined;
  const modelId = process.env.MEMORIES_EMBEDDING_MODEL?.trim() || DEFAULT_EMBEDDING_MODEL;
  if (modelId.length === 0) return undefined;
  return createMemoriesEmbeddingModel({
    model: modelId,
    providerOptions: isGoogleEmbeddingModelId(modelId)
      ? mergeResolutionAndProviderOptions(parseEmbeddingPreset())
      : undefined,
  });
}
