import {
  type LabelSchemaMap,
  type OntologyDefinition,
  validateEdgeLabel,
  validateNodeLabel,
} from "@khoralabs/memories-ontologies";
import type { ResolvedSource } from "@khoralabs/sourcemaps";
import type { MemoriesPersistenceAsync } from "../../persistence/core/persistence";
import type { DeleteMemoryParams } from "../models/delete-memory";
import { deleteMemoryAsync } from "../models/delete-memory-async";
import type { DefaultEntityMap, MemoriesClientOptions } from "./client";
import {
  type MergeMemoryParams,
  type MutationCtxAsync,
  mergeMemoryAsync,
  zMergeMemoryContentItem,
} from "./merge-memory-async";
import type { Store } from "./resolve-sourcemap.js";
import {
  type SearchHit,
  type SearchOutput,
  type SearchParams,
  searchAsync as searchHandlerAsync,
} from "./search-async";

type LabelKind<TLabels extends LabelSchemaMap> = keyof TLabels & string;

export type TypedMergeParamsAsync<
  TNode extends LabelSchemaMap,
  TEdge extends LabelSchemaMap,
> = MergeMemoryParams<TNode, TEdge>;

export type TypedSearchParamsAsync<
  TNode extends LabelSchemaMap,
  TEdge extends LabelSchemaMap,
> = SearchParams<LabelKind<TNode>, LabelKind<TEdge>>;

export type TypedSearchHitAsync<
  TNode extends LabelSchemaMap,
  TEdge extends LabelSchemaMap,
> = SearchHit<LabelKind<TNode>, LabelKind<TEdge>>;

export type TypedSearchOutputAsync<
  TNode extends LabelSchemaMap,
  TEdge extends LabelSchemaMap,
> = SearchOutput<LabelKind<TNode>, LabelKind<TEdge>>;

/**
 * Async variant of {@link MemoriesClient} for {@link MemoriesPersistenceAsync} backends.
 */
export class MemoriesClientAsync<
  TNode extends LabelSchemaMap,
  TEdge extends LabelSchemaMap,
  EntityMap extends Record<string, unknown> = DefaultEntityMap,
> {
  readonly ontology: OntologyDefinition<TNode, TEdge>;
  readonly persistence: MemoriesPersistenceAsync;
  private readonly store?: Store<EntityMap>;
  private readonly storeForNamespace?: (namespace: string) => Store<EntityMap> | undefined;

  constructor(
    persistence: MemoriesPersistenceAsync,
    ontology: OntologyDefinition<TNode, TEdge>,
    options?: MemoriesClientOptions<EntityMap>,
  ) {
    this.persistence = persistence;
    this.ontology = ontology;
    this.store = options?.store;
    this.storeForNamespace = options?.storeForNamespace;
  }

  private get mutationCtx(): MutationCtxAsync {
    return { persistence: this.persistence };
  }

  private storeForMergeNamespace(namespace: string): Store<EntityMap> | undefined {
    return this.storeForNamespace?.(namespace) ?? this.store;
  }

  private async syncLexicalExportToStore(
    _namespace: string,
    mergedMemoryIds: string[],
  ): Promise<void> {
    const store = this.storeForMergeNamespace(_namespace);
    const pushRows = store?.syncFromTextExportRows;
    if (pushRows === undefined) {
      return;
    }
    for (const memoryId of mergedMemoryIds) {
      const rows = await this.persistence.listTextFeatureExportRowsForMemory(memoryId);
      pushRows.call(store, rows);
    }
  }

  async mergeMemory(params: TypedMergeParamsAsync<TNode, TEdge>): Promise<string[]> {
    for (const item of params.content) {
      zMergeMemoryContentItem.parse(item);
    }

    if (params.kind === "edge") {
      const mergedKeys = await mergeMemoryAsync(this.mutationCtx, {
        kind: "edge",
        key: params.key,
        namespace: params.namespace,
        content: params.content,
        edge: {
          from_memory_id: params.edge.from_memory_id,
          to_memory_id: params.edge.to_memory_id,
          label: validateEdgeLabel(this.ontology, params.edge.label),
          properties: params.edge.properties,
        },
        attachScopes: params.attachScopes,
        searchMetaVector: params.searchMetaVector,
        ontology: this.ontology,
        attribution: params.attribution,
      });
      await this.syncLexicalExportToStore(params.namespace, mergedKeys);
      return mergedKeys;
    }

    const labelInstances = params.labels.map((l) => validateNodeLabel(this.ontology, l));

    const edgesMapped =
      params.edges?.map((e) => ({
        peer_memory_id: e.peer_memory_id,
        direction: e.direction,
        label: validateEdgeLabel(this.ontology, e.label),
        properties: e.properties,
      })) ?? [];

    const mergedKeys = await mergeMemoryAsync(this.mutationCtx, {
      key: params.key,
      namespace: params.namespace,
      content: params.content,
      labels: labelInstances,
      properties: params.properties,
      edges: edgesMapped,
      attachScopes: params.attachScopes,
      searchMetaVector: params.searchMetaVector,
      ontology: this.ontology,
      attribution: params.attribution,
    });
    await this.syncLexicalExportToStore(params.namespace, mergedKeys);
    return mergedKeys;
  }

  async deleteMemory(params: DeleteMemoryParams): Promise<void> {
    return deleteMemoryAsync(this.mutationCtx, params);
  }

  async search(
    params: TypedSearchParamsAsync<TNode, TEdge>,
  ): Promise<TypedSearchOutputAsync<TNode, TEdge>> {
    return searchHandlerAsync(this.mutationCtx, params);
  }

  async resolveSourcesForMemory(
    namespace: string,
    memoryId: string,
    limit: number,
  ): Promise<Array<{ sourceKey: string; content: ResolvedSource<EntityMap> | null }>> {
    const store = this.storeForMergeNamespace(namespace);
    if (store === undefined) {
      throw new Error(
        "MemoriesClientAsync: pass store or storeForNamespace in the constructor to use resolveSourcesForMemory",
      );
    }
    const maps = await this.persistence.listSourceMapsForMemory(memoryId, limit);
    const out: Array<{ sourceKey: string; content: ResolvedSource<EntityMap> | null }> = [];
    for (const sm of maps) {
      let content: ResolvedSource<EntityMap> | null = null;
      try {
        content = await store.resolve(sm);
      } catch {
        content = null;
      }
      out.push({ sourceKey: sm.source_key, content });
    }
    return out;
  }
}
