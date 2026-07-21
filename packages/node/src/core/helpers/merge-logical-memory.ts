import type { LabelSchemaMap } from "@khoralabs/memories-ontologies";
import {
  buildCanonicalMemorySearchMetaText,
  buildCanonicalMemorySearchMetaTextAsync,
  resolveMemoriesBackendCapabilities,
  upsertMemorySearchMetaVector,
  upsertMemorySearchMetaVectorAsync,
} from "@khoralabs/memories-persistence-core/persistence";
import type { MemoriesClient, TypedSearchHit } from "../api/client";
import { MemoriesClientAsync } from "../api/client-async";
import type { MergeMemoryContentItem, MergeMemoryParamsNode } from "../api/merge-memory";
import type { SearchContent } from "../api/search";
import type { EmbeddingModel } from "./embedding-model";
import { embedTextChunks } from "./embedding-model";
import type { ProcessedLogicalMemory } from "./logical-memory";

/** Strip merge `key` and narrow optional fields to {@link SearchContent}. */
export function mergeMemoryItemToSearchContent(item: MergeMemoryContentItem): SearchContent {
  const { text, vector } = item;
  if (text !== undefined && vector !== undefined) {
    return { text, vector };
  }
  if (text !== undefined) {
    return { text };
  }
  if (vector !== undefined) {
    return { vector };
  }
  throw new Error("MergeMemoryContentItem must include text and/or vector");
}

export async function prefetchRelatedMemories<
  TNode extends LabelSchemaMap,
  TEdge extends LabelSchemaMap,
>(
  client: MemoriesClient<TNode, TEdge> | MemoriesClientAsync<TNode, TEdge>,
  namespace: string,
  contentItems: MergeMemoryContentItem[],
): Promise<TypedSearchHit<TNode, TEdge>[]> {
  const contentSearchHits: TypedSearchHit<TNode, TEdge>[] = [];
  const seenHits = new Set<string>();
  for (const item of contentItems) {
    const hits = await Promise.resolve(
      client.search({
        namespace,
        content: mergeMemoryItemToSearchContent(item),
        options: {
          topK: 10,
          minScore: 0.5,
        },
      }),
    );
    for (const hit of hits.hits) {
      if (seenHits.has(hit.memory._id)) continue;
      seenHits.add(hit.memory._id);
      contentSearchHits.push(hit);
    }
  }

  return contentSearchHits;
}

/**
 * Applies a validated merge **slice** (labels/edges/properties) with {@link ProcessedLogicalMemory.content},
 * then refreshes search-meta vectors when the backend supports vector search.
 */
export async function mergeLogicalMemoryWithMergeSlice<
  TNode extends LabelSchemaMap,
  TEdge extends LabelSchemaMap,
>(
  client: MemoriesClient<TNode, TEdge> | MemoriesClientAsync<TNode, TEdge>,
  processedLogicalMemory: ProcessedLogicalMemory,
  slice: Pick<MergeMemoryParamsNode<TNode, TEdge>, "labels" | "edges" | "properties">,
  embeddingModel: EmbeddingModel,
): Promise<void> {
  if (client instanceof MemoriesClientAsync) {
    const metaSyncedKeys = await client.mergeMemory({
      key: processedLogicalMemory.key,
      namespace: processedLogicalMemory.namespace,
      content: processedLogicalMemory.content,
      labels: slice.labels,
      edges: slice.edges,
      properties: slice.properties,
    });

    const namespace = processedLogicalMemory.namespace;
    const readOp = { now: Date.now() };
    const pairs: { memoryKey: string; text: string }[] = [];
    for (const memoryKey of metaSyncedKeys) {
      const text = await buildCanonicalMemorySearchMetaTextAsync(
        client.persistence,
        readOp,
        namespace,
        memoryKey,
      );
      if (text.length > 0) pairs.push({ memoryKey, text });
    }

    if (pairs.length === 0) return;

    const caps = resolveMemoriesBackendCapabilities(client.persistence);
    if (!caps.vectorSearch) {
      return;
    }

    const embeddings = await embedTextChunks(
      embeddingModel,
      pairs.map((p) => p.text),
    );
    if (embeddings.length !== pairs.length) {
      throw new Error(
        `mergeLogicalMemoryWithMergeSlice: expected ${pairs.length} search-meta embeddings, got ${embeddings.length}`,
      );
    }

    await client.persistence.withTransaction(async () => {
      const op = { now: Date.now() };
      for (let i = 0; i < pairs.length; i++) {
        const pair = pairs[i];
        const vec = embeddings[i];
        if (pair === undefined || vec === undefined || vec.length === 0) {
          throw new Error(
            "mergeLogicalMemoryWithMergeSlice: missing embedding for search-meta batch",
          );
        }
        await upsertMemorySearchMetaVectorAsync(client.persistence, op, {
          namespace,
          memoryKey: pair.memoryKey,
          vector: new Float32Array(vec),
        });
      }
    });
    return;
  }

  const metaSyncedKeys = client.mergeMemory({
    key: processedLogicalMemory.key,
    namespace: processedLogicalMemory.namespace,
    content: processedLogicalMemory.content,
    labels: slice.labels,
    edges: slice.edges,
    properties: slice.properties,
  });

  const namespace = processedLogicalMemory.namespace;
  const readOp = { now: Date.now() };
  const pairs = metaSyncedKeys
    .map((memoryKey) => ({
      memoryKey,
      text: buildCanonicalMemorySearchMetaText(client.persistence, readOp, namespace, memoryKey),
    }))
    .filter((p) => p.text.length > 0);

  if (pairs.length === 0) return;

  const caps = resolveMemoriesBackendCapabilities(client.persistence);
  if (!caps.vectorSearch) {
    return;
  }

  const embeddings = await embedTextChunks(
    embeddingModel,
    pairs.map((p) => p.text),
  );
  if (embeddings.length !== pairs.length) {
    throw new Error(
      `mergeLogicalMemoryWithMergeSlice: expected ${pairs.length} search-meta embeddings, got ${embeddings.length}`,
    );
  }

  client.persistence.withTransaction(() => {
    const op = { now: Date.now() };
    for (let i = 0; i < pairs.length; i++) {
      const pair = pairs[i];
      const vec = embeddings[i];
      if (pair === undefined || vec === undefined || vec.length === 0) {
        throw new Error(
          "mergeLogicalMemoryWithMergeSlice: missing embedding for search-meta batch",
        );
      }
      upsertMemorySearchMetaVector(client.persistence, op, {
        namespace,
        memoryKey: pair.memoryKey,
        vector: new Float32Array(vec),
      });
    }
  });
}
