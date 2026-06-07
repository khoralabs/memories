import type { Database } from "bun:sqlite";
import type {
  EdgePreviewPayload,
  GraphMemoryEmbedding,
  MemoriesPersistence,
} from "@khoralabs/memories-core";
import { loadEdgePreview } from "./edge-preview";
import { loadMeanEmbeddingsForNamespace } from "./mean-embeddings";
import { loadMemoryTextPreview } from "./memory-preview";

/**
 * SQLite graph-study adapter: mean-pooled embeddings and text/edge previews for UI.
 * Graph topology reads stay on {@link MemoriesPersistence}.
 */
export class MemoriesVisualization {
  constructor(
    private readonly db: Database,
    private readonly persistence: Pick<MemoriesPersistence, "loadGraphEdge">,
  ) {}

  loadMeanEmbeddingsForNamespace(namespace: string): GraphMemoryEmbedding[] {
    return loadMeanEmbeddingsForNamespace(this.db, namespace);
  }

  loadMemoryTextPreview(namespace: string, key: string, maxChars?: number): string | null {
    return loadMemoryTextPreview(this.db, namespace, key, maxChars);
  }

  loadEdgePreview(namespace: string, edgeId: string): EdgePreviewPayload | null {
    return loadEdgePreview(this.persistence, namespace, edgeId);
  }
}

export function createMemoriesVisualization(
  db: Database,
  persistence: Pick<MemoriesPersistence, "loadGraphEdge">,
): MemoriesVisualization {
  return new MemoriesVisualization(db, persistence);
}
