import type { MergeMemoryContentItem } from "../api/merge-memory";
import { type EmbeddingModel, embedTextChunks, MAX_TEXT_CHUNK_CHARS } from "./embedding-model";

export interface TextToContentInput {
  text: string;
  retrievalText?: string;
  lexicalText?: string;
  keyPrefix?: string;
  maxChunkChars?: number;
  embeddingModel: EmbeddingModel;
}

export interface TextToContentResult {
  kind: "text";
  retrievalText: string;
  lexicalText: string;
  chunkCount: number;
  content: MergeMemoryContentItem[];
}

export function splitTextContent(text: string, maxChunkChars = MAX_TEXT_CHUNK_CHARS): string[] {
  const paragraphs = text
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n+/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  const chunks = paragraphs.length > 0 ? paragraphs : [text.trim()].filter(Boolean);
  return chunks.flatMap((chunk) => {
    if (chunk.length <= maxChunkChars) return [chunk];
    const out: string[] = [];
    for (let start = 0; start < chunk.length; start += maxChunkChars) {
      out.push(chunk.slice(start, start + maxChunkChars));
    }
    return out;
  });
}

export async function textToContent(input: TextToContentInput): Promise<TextToContentResult> {
  const retrievalText = (input.retrievalText ?? input.text).trim();
  if (retrievalText.length === 0) {
    throw new Error("No text content to embed");
  }

  const lexicalText = (input.lexicalText ?? retrievalText).trim() || retrievalText;
  const chunkTexts = splitTextContent(retrievalText, input.maxChunkChars);
  if (chunkTexts.length === 0) {
    throw new Error("No text chunks were produced");
  }

  const embeddingVectors = await embedTextChunks(input.embeddingModel, chunkTexts);
  const keyPrefix = input.keyPrefix ?? "chunk";
  const content = chunkTexts.map<MergeMemoryContentItem>((chunkText, index) => {
    const vector = embeddingVectors[index];
    if (!vector) {
      throw new Error(`Missing embedding at index ${index}`);
    }
    return {
      key: `${keyPrefix}:${index}`,
      text: chunkText,
      vector,
    };
  });

  return {
    kind: "text",
    retrievalText,
    lexicalText,
    chunkCount: content.length,
    content,
  };
}
