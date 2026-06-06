import type {
  DefaultEntityMap,
  Store as GenericStore,
  ResolvedSourceWire,
  SourceRef,
} from "@khoralabs/sourcemaps";
import type {
  SourceMap,
  SourceMapLocators,
  TextFeatureExportRow,
} from "../persistence/row-schemas.js";

export type { SourceMap, SourceMapLocators };

/** Subset sufficient for {@link Store.resolve} and wire interchange (before content hash is set). */
export type SourceMapRef = SourceRef<SourceMapLocators>;

/**
 * One line in a file-backed store (e.g. JSONL): {@link SourceMapRef} plus a {@link ResolvedSourceWire} body.
 */
export type ResolvedSourceMapLine = SourceMapRef & ResolvedSourceWire;

export interface Store<EntityMap extends Record<string, unknown> = DefaultEntityMap>
  extends GenericStore<SourceMap, EntityMap> {
  /**
   * When implemented (e.g. {@code JsonlStore}), called after {@link MemoriesClient.mergeMemory} to mirror
   * lexical rows keyed like {@link SourceMap} addresses into a file-backed store.
   */
  syncFromTextExportRows?(rows: readonly TextFeatureExportRow[]): void;
}
