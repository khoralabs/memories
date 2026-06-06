import type { EmbeddingModel } from "@khoralabs/memories-tools";

/** Per-request metadata for domain ingestion (correlation, tenant, etc.). */
export type AdapterIngestContext = {
  correlationId?: string;
  sourceApp?: string;
  userId?: string;
};

/** One logical memory file part (structural match for librarian ingest). */
export interface LogicalMemoryFilePart {
  blob: Blob;
  mimeType?: string;
  fileName?: string | null;
  title?: string;
  fallbackText?: string;
}

/** Structural match for `Librarian.processLogicalMemory` input. */
export interface LogicalMemoryInput {
  key: string;
  namespace: string;
  plaintext?: string;
  files?: LogicalMemoryFilePart[];
  embedding?: {
    embeddingModel: EmbeddingModel;
    multimodal: boolean;
  };
}

/** LLM expansion result before handoff to merge / integration. */
export type ExpandedMemoryDraft = {
  plaintext: string;
  memoryKeySuggestion?: string;
  /** Optional ontology-aware node label hints (keyed by node kind). */
  nodeLabelHints?: Record<string, unknown>;
  /** Optional ontology-aware edge hints (neighbor key + direction + at most one edge kind payload per row). */
  edgeLabelHints?: Record<string, unknown>[];
};

export function expandedDraftToLogicalMemoryInput(
  draft: ExpandedMemoryDraft,
  namespace: string,
  defaultKey: string,
): LogicalMemoryInput {
  const key = draft.memoryKeySuggestion?.trim() || defaultKey;
  return {
    key,
    namespace,
    plaintext: draft.plaintext.trim(),
  };
}
