/**
 * @deprecated Import from `./projection-input` (or `@khoralabs/memories-node/projections/projection-input`).
 * These aliases remain for migration.
 */
export {
  type CollectProjectionInputOptions as CollectUmapInputOptions,
  collectNamespaceProjectionInput as collectNamespaceUmapInput,
  type DecodeProjectionInputOptions as DecodeUmapInputOptions,
  decodeProjectionInput as decodeUmapInput,
  type EncodeProjectionInputOptions as EncodeUmapInputOptions,
  encodeProjectionInput as encodeUmapInput,
  type NamespaceProjectionInput as NamespaceUmapInput,
  PROJECTION_INPUT_ENCODING_HEADER as UMAP_INPUT_ENCODING_HEADER,
  PROJECTION_INPUT_VERSION as UMAP_INPUT_VERSION,
  type ProjectionInputCompression as UmapInputCompression,
  type ProjectionInputScope as UmapInputScope,
  validateProjectionInput as validateUmapInput,
} from "./projection-input";

/** @deprecated Prefer PROJECTION_INPUT_CONTENT_TYPE; old wire mime for header comparisons. */
export const UMAP_INPUT_CONTENT_TYPE = "application/vnd.khoralabs.memories.umap-input+json";
