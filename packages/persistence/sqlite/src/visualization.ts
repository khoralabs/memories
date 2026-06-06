import type { Database } from "bun:sqlite";
import type { EdgePreviewPayload, GraphMemoryEmbedding } from "@khoralabs/memories-core";
import { loadEdgePreview } from "./visualization/edge-preview";
import { loadMemoryTextPreview } from "./visualization/memory-preview";
import { loadMeanEmbeddingsForNamespace } from "./visualization/projection";

/**
 * SQLite-only adapter: mean-pooled embeddings and text/edge previews for UI.
 * Graph topology (edges, labels, properties) is on {@link MemoriesPersistence}.
 */
export class MemoriesVisualization {
  constructor(private readonly db: Database) {}

  loadMeanEmbeddingsForNamespace(namespace: string): GraphMemoryEmbedding[] {
    return loadMeanEmbeddingsForNamespace(this.db, namespace);
  }

  loadMemoryTextPreview(namespace: string, key: string, maxChars?: number): string | null {
    return loadMemoryTextPreview(this.db, namespace, key, maxChars);
  }

  loadEdgePreview(namespace: string, edgeId: string): EdgePreviewPayload | null {
    return loadEdgePreview(this.db, namespace, edgeId);
  }
}

export function createMemoriesVisualization(db: Database): MemoriesVisualization {
  return new MemoriesVisualization(db);
}
