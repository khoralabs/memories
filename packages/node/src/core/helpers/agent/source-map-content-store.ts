import type { SourceMap, Store } from "../../../index.ts";
import { ids } from "../../../index.ts";

export const MEMORY_TEXT_SOURCE_PREFIX = "text";
export const DEFAULT_MEMORY_SOURCE_KEY = `${MEMORY_TEXT_SOURCE_PREFIX}:0`;

export type SourceMapTextPreviewClient = {
  persistence: {
    getSourceMapTextPreview(sourceMapId: string, maxChars?: number): Promise<string | null>;
  };
};

export function createRemoteSourceMapContentStore(client: SourceMapTextPreviewClient): Store {
  return {
    async resolve(ref: SourceMap) {
      const memoryId = ref.memory_id?.trim() ?? "";
      const sourceKey = ref.source_key?.trim() || DEFAULT_MEMORY_SOURCE_KEY;
      if (memoryId.length === 0) {
        throw new Error("source map ref missing memory_id");
      }
      const sourceMapId = ids.sourceMap(memoryId, sourceKey);
      const text = await client.persistence.getSourceMapTextPreview(sourceMapId, 100_000);
      if (text === null) {
        throw new Error(`source map content not found: ${memoryId}/${sourceKey}`);
      }
      return { kind: "string", string: text };
    },
  };
}
