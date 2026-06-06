import type { MergeMemoryContentItem } from "../api/merge-memory";
import { type EmbeddingModel, embedBinaryBlob } from "./embedding-model";
import { textToContent } from "./text-to-content";

export interface FileToContentInput {
  blob: Blob;
  mimeType?: string;
  fileName?: string | null;
  title?: string;
  fallbackText?: string;
  keyPrefix?: string;
  embeddingModel: EmbeddingModel;
  /** When true, non-text blobs use multimodal (Google) embedding; otherwise throws. */
  multimodal: boolean;
}

export interface FileToContentResult {
  kind: "text-file" | "binary-file";
  mimeType: string;
  isTextLike: boolean;
  fileName?: string | null;
  title?: string;
  retrievalText: string;
  lexicalText?: string;
  chunkCount: number;
  content: MergeMemoryContentItem[];
}

export function isTextLikeMime(mimeType: string): boolean {
  return (
    mimeType.startsWith("text/") ||
    mimeType === "application/json" ||
    mimeType === "application/xml" ||
    mimeType === "application/yaml" ||
    mimeType === "text/markdown" ||
    mimeType === "application/javascript"
  );
}

export function buildRetrievalText(args: {
  text?: string;
  title?: string;
  fileName?: string | null;
  mimeType: string;
  fallbackText?: string;
}): string {
  const text = args.text?.trim();
  if (text) return text;

  const fallbackText = args.fallbackText?.trim();
  if (fallbackText) return fallbackText;

  return (
    [args.title, args.fileName, args.mimeType].filter(Boolean).join(" ").trim() || "binary file"
  );
}

export async function fileToContent(input: FileToContentInput): Promise<FileToContentResult> {
  const mimeType = (input.mimeType ?? input.blob.type) || "application/octet-stream";
  const { embeddingModel, multimodal } = input;

  if (isTextLikeMime(mimeType)) {
    const text = (await input.blob.text()).trim();
    const retrievalText = buildRetrievalText({
      text,
      title: input.title,
      fileName: input.fileName,
      mimeType,
      fallbackText: input.fallbackText,
    });
    const result = await textToContent({
      embeddingModel,
      text,
      retrievalText,
      lexicalText: retrievalText,
      keyPrefix: input.keyPrefix ?? "chunk",
    });
    return {
      kind: "text-file",
      mimeType,
      isTextLike: true,
      fileName: input.fileName,
      title: input.title,
      retrievalText: result.retrievalText,
      lexicalText: result.lexicalText,
      chunkCount: result.chunkCount,
      content: result.content,
    };
  }

  if (!multimodal) {
    throw new Error(
      "Non-text file embedding requires multimodal: enable multimodal and use gemini-embedding-2-preview, or supply text-like content only.",
    );
  }

  const retrievalText = buildRetrievalText({
    title: input.title,
    fileName: input.fileName,
    mimeType,
    fallbackText: input.fallbackText,
  });
  const vector = await embedBinaryBlob(embeddingModel, {
    blob: input.blob,
    mimeType,
    retrievalText,
  });
  const content: MergeMemoryContentItem[] = [
    {
      key: `${input.keyPrefix ?? "binary"}:0`,
      vector,
    },
  ];

  return {
    kind: "binary-file",
    mimeType,
    isTextLike: false,
    fileName: input.fileName,
    title: input.title,
    retrievalText,
    chunkCount: content.length,
    content,
  };
}
