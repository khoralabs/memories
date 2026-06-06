import type { MergeMemoryContentItem } from "../api/merge-memory";
import type { EmbeddingModel } from "./embedding-model";
import { fileToContent as fileToContentFn } from "./file-to-content";
import { textToContent as textToContentFn } from "./text-to-content";

/** One logical memory: optional plaintext and/or multiple files; embedding decomposes into many merge chunks. */
export interface LogicalMemoryFilePart {
  blob: Blob;
  mimeType?: string;
  fileName?: string | null;
  title?: string;
  fallbackText?: string;
}

export interface LogicalMemoryInput {
  /** Target memory key for `MemoriesClient.mergeMemory`. */
  key: string;
  namespace: string;
  plaintext?: string;
  files?: LogicalMemoryFilePart[];
  /**
   * Injected by the pipeline: {@link embeddingModel} and {@link multimodal} (binary files require multimodal).
   */
  embedding?: {
    embeddingModel: EmbeddingModel;
    multimodal: boolean;
  };
}

export interface ProcessedLogicalMemory extends LogicalMemoryInput {
  content: MergeMemoryContentItem[];
}

// Re-export EmbeddingModel from embedding-model for convenience
export type { EmbeddingModel } from "./embedding-model";

/**
 * Runs the embedding adapters: plaintext (if any) plus each file, with stable key prefixes
 * (`text:*`, `file:i:*`), then concatenates into one `content` array for a single merge.
 */
export async function decomposeLogicalMemoryToContent(
  input: LogicalMemoryInput,
): Promise<MergeMemoryContentItem[]> {
  const embeddingModel = input.embedding?.embeddingModel;
  const multimodal = input.embedding?.multimodal ?? false;
  if (!embeddingModel) {
    throw new Error("decomposeLogicalMemoryToContent: embedding.embeddingModel is required");
  }

  const out: MergeMemoryContentItem[] = [];

  if (input.plaintext?.trim()) {
    const r = await textToContentFn({
      text: input.plaintext.trim(),
      embeddingModel,
      keyPrefix: "text",
    });
    out.push(...r.content);
  }

  if (input.files?.length) {
    for (let i = 0; i < input.files.length; i++) {
      const f = input.files[i];
      if (f === undefined) continue;
      const r = await fileToContentFn({
        blob: f.blob,
        mimeType: f.mimeType,
        fileName: f.fileName,
        title: f.title,
        fallbackText: f.fallbackText,
        embeddingModel,
        multimodal,
        keyPrefix: `file:${i}`,
      });
      out.push(...r.content);
    }
  }

  if (out.length === 0) {
    throw new Error("Logical memory has no plaintext or files to embed");
  }

  return out;
}
