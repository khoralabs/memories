import { ids } from "../../persistence/core";
import type { MemoryOpContext } from "../../persistence/core/persistence";
import { computeSourceMapContentHash } from "../../persistence/core/provenance";

/**
 * Shared replace-feature transaction body: preserve sibling arms, clear one source map,
 * reinsert finals, update content hash. Callers append provenance/outbox.
 */
export function applyReplaceMemoryFeatureArmsSync(
  persistence: {
    getSourceMapText(sourceMapId: string): string | null;
    getSourceMapVector(sourceMapId: string): Float32Array | null;
    clearSourceMapFeatures(op: MemoryOpContext, sourceMapId: string): void;
    insertSourceMap(
      op: MemoryOpContext,
      input: { memoryId: string; sourceKey: string },
    ): { sourceMapId: string };
    insertLexicalFeature(
      op: MemoryOpContext,
      input: { memoryId: string; sourceMapId: string; text: string },
    ): unknown;
    insertVectorFeature(
      op: MemoryOpContext,
      input: { memoryId: string; sourceMapId: string; vector: Float32Array },
    ): unknown;
    updateSourceMapContentHash(
      op: MemoryOpContext,
      input: { sourceMapId: string; text?: string; vector?: Float32Array },
    ): void;
  },
  op: MemoryOpContext,
  input: {
    memoryId: string;
    sourceKey: string;
    text?: string;
    vector?: Float32Array;
  },
): { sourceMapId: string; text?: string; vector?: Float32Array; contentHash: string } {
  const sourceMapId = ids.sourceMap(input.memoryId, input.sourceKey);
  const existingText = persistence.getSourceMapText(sourceMapId);
  const existingVector = persistence.getSourceMapVector(sourceMapId);
  const text = input.text !== undefined ? input.text : (existingText ?? undefined);
  const vector = input.vector !== undefined ? input.vector : (existingVector ?? undefined);

  persistence.clearSourceMapFeatures(op, sourceMapId);
  persistence.insertSourceMap(op, {
    memoryId: input.memoryId,
    sourceKey: input.sourceKey,
  });
  if (text !== undefined) {
    persistence.insertLexicalFeature(op, {
      memoryId: input.memoryId,
      sourceMapId,
      text,
    });
  }
  if (vector !== undefined) {
    persistence.insertVectorFeature(op, {
      memoryId: input.memoryId,
      sourceMapId,
      vector,
    });
  }
  persistence.updateSourceMapContentHash(op, { sourceMapId, text, vector });
  const contentHash = computeSourceMapContentHash({ text, vector });
  return { sourceMapId, text, vector, contentHash };
}

/** Async counterpart of {@link applyReplaceMemoryFeatureArmsSync}. */
export async function applyReplaceMemoryFeatureArmsAsync(
  persistence: {
    getSourceMapText(sourceMapId: string): Promise<string | null>;
    getSourceMapVector(sourceMapId: string): Promise<Float32Array | null>;
    clearSourceMapFeatures(op: MemoryOpContext, sourceMapId: string): Promise<void>;
    insertSourceMap(
      op: MemoryOpContext,
      input: { memoryId: string; sourceKey: string },
    ): Promise<{ sourceMapId: string }>;
    insertLexicalFeature(
      op: MemoryOpContext,
      input: { memoryId: string; sourceMapId: string; text: string },
    ): Promise<unknown>;
    insertVectorFeature(
      op: MemoryOpContext,
      input: { memoryId: string; sourceMapId: string; vector: Float32Array },
    ): Promise<unknown>;
    updateSourceMapContentHash(
      op: MemoryOpContext,
      input: { sourceMapId: string; text?: string; vector?: Float32Array },
    ): Promise<void>;
  },
  op: MemoryOpContext,
  input: {
    memoryId: string;
    sourceKey: string;
    text?: string;
    vector?: Float32Array;
  },
): Promise<{ sourceMapId: string; text?: string; vector?: Float32Array; contentHash: string }> {
  const sourceMapId = ids.sourceMap(input.memoryId, input.sourceKey);
  const existingText = await persistence.getSourceMapText(sourceMapId);
  const existingVector = await persistence.getSourceMapVector(sourceMapId);
  const text = input.text !== undefined ? input.text : (existingText ?? undefined);
  const vector = input.vector !== undefined ? input.vector : (existingVector ?? undefined);

  await persistence.clearSourceMapFeatures(op, sourceMapId);
  await persistence.insertSourceMap(op, {
    memoryId: input.memoryId,
    sourceKey: input.sourceKey,
  });
  if (text !== undefined) {
    await persistence.insertLexicalFeature(op, {
      memoryId: input.memoryId,
      sourceMapId,
      text,
    });
  }
  if (vector !== undefined) {
    await persistence.insertVectorFeature(op, {
      memoryId: input.memoryId,
      sourceMapId,
      vector,
    });
  }
  await persistence.updateSourceMapContentHash(op, { sourceMapId, text, vector });
  const contentHash = computeSourceMapContentHash({ text, vector });
  return { sourceMapId, text, vector, contentHash };
}
