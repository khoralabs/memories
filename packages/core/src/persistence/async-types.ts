import type { NamespacePath } from "../models/namespace-path";
import type {
  HydratedNeighbor,
  HydratedSourceMapHit,
  NeighborFilter,
} from "../models/neighbor-search-types";
import type { MemoriesBackendCapabilities, MemoriesPersistence, MemoryOpContext } from "./types";

type PromisifyMethodMap<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? (...args: A) => Promise<Awaited<R>>
    : T[K];
};

/** Sync methods whose generics are lost if naively promisified; declared explicitly below. */
type MemoriesPersistenceAsyncCore = Omit<
  MemoriesPersistence,
  | "withTransaction"
  | "capabilities"
  | "hydrateSourceMapHits"
  | "listNeighborsForMemory"
  | "syncLabelPropsSearchFeatures"
>;

/**
 * Async / remote-friendly persistence: every method returns a `Promise`, and
 * `withTransaction` accepts an async callback.
 */
export type MemoriesPersistenceAsync = PromisifyMethodMap<MemoriesPersistenceAsyncCore> & {
  withTransaction<T>(fn: () => Promise<T>): Promise<T>;
  capabilities?: MemoriesBackendCapabilities;
  /**
   * Async label-props lexical rebuild (remote / non-blocking stores). Omitted = same as sync backends that skip it.
   * Declared here so optional chaining does not drop `Promise` typing from promisify inference.
   */
  syncLabelPropsSearchFeatures?(
    op: MemoryOpContext,
    input: { namespace: NamespacePath; memoryKey: string },
  ): Promise<void>;
  hydrateSourceMapHits(sourceMapIds: readonly string[]): Promise<HydratedSourceMapHit[]>;
  listNeighborsForMemory<
    EDGE_LABEL extends string = string,
    NODE_LABEL extends string = string,
  >(input: {
    namespace: NamespacePath;
    key: string;
    filters?: NeighborFilter<EDGE_LABEL, NODE_LABEL>;
  }): Promise<HydratedNeighbor[]>;
};
