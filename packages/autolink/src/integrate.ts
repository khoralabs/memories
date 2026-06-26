import type {
  LabelSchemaMap,
  MemoriesClient,
  MemoriesClientAsync,
  MergeMemoryParamsNode,
  NamespacePath,
  NodeLabelInstance,
  SearchContent,
  SearchHit,
  SearchParams,
} from "@khoralabs/memories-core";
import { type ComputeLexicalLinkOptions, computeLexicalLinkMergeSlice } from "./planner.js";
import { normalizeSearchConfigSnapshot } from "./search-config.js";

export type IntegrateNewMemoryArgs<
  TNode extends LabelSchemaMap,
  TEdge extends LabelSchemaMap,
> = Pick<
  MergeMemoryParamsNode<TNode, TEdge>,
  "namespace" | "key" | "content" | "properties" | "searchMetaVector" | "attachScopes"
> & {
  labels?: NodeLabelInstance<TNode>[];
  edges?: NonNullable<MergeMemoryParamsNode<TNode, TEdge>["edges"]>;
  searchContent: SearchContent;
  searchOptions?: SearchParams["options"];
  additionalNamespaces?: NamespacePath[];
  searchEntireDatabase?: true;
  /** Planning options; `searchConfig` on edges is derived from the search call. */
  linkPlan?: Omit<ComputeLexicalLinkOptions, "searchConfig">;
};

/**
 * Runs search for {@link IntegrateNewMemoryArgs.searchContent}, builds a lexical link patch,
 * then merges the focal node with user content/labels/edges plus the patch.
 * Works with sync {@link MemoriesClient} or {@link MemoriesClientAsync} (awaited uniformly).
 *
 * Requires a merged ontology that includes the retrieval similarity ontology kinds.
 */
export async function integrateNewMemoryIntoGraph<
  TNode extends LabelSchemaMap,
  TEdge extends LabelSchemaMap,
>(
  client: MemoriesClient<TNode, TEdge> | MemoriesClientAsync<TNode, TEdge>,
  args: IntegrateNewMemoryArgs<TNode, TEdge>,
): Promise<string[]> {
  const searchOptions: NonNullable<SearchParams["options"]> = {
    topK: 25,
    ...args.searchOptions,
  };

  const searchParams = {
    namespace: args.namespace,
    content: args.searchContent,
    options: searchOptions,
    ...(args.additionalNamespaces !== undefined
      ? { additionalNamespaces: args.additionalNamespaces }
      : {}),
    ...(args.searchEntireDatabase === true ? { searchEntireDatabase: true as const } : {}),
  } satisfies SearchParams;

  const hits: SearchHit[] = await Promise.resolve(
    client.search(searchParams as Parameters<MemoriesClient<TNode, TEdge>["search"]>[0]),
  );

  const searchConfig = normalizeSearchConfigSnapshot({
    namespace: args.namespace,
    content: args.searchContent,
    options: searchOptions,
    ...(args.additionalNamespaces !== undefined
      ? { additionalNamespaces: args.additionalNamespaces }
      : {}),
    ...(args.searchEntireDatabase === true ? { searchEntireDatabase: true } : {}),
  });

  const link: Partial<Omit<ComputeLexicalLinkOptions, "searchConfig">> = args.linkPlan ?? {};
  const patch = computeLexicalLinkMergeSlice(args.key, hits, {
    searchConfig,
    topK: link.topK ?? 10,
    minSimilarityScore: link.minSimilarityScore,
    skipEdgeMemories: link.skipEdgeMemories,
    tagSourceNode: link.tagSourceNode,
  });

  const mergedLabels = [
    ...(args.labels ?? []),
    ...(patch.labels ?? []),
  ] as NodeLabelInstance<TNode>[];
  const mergedEdges = [...(args.edges ?? []), ...(patch.edges ?? [])] as NonNullable<
    MergeMemoryParamsNode<TNode, TEdge>["edges"]
  >;

  return await Promise.resolve(
    client.mergeMemory({
      namespace: args.namespace,
      key: args.key,
      content: args.content,
      labels: mergedLabels,
      ...(mergedEdges.length > 0 ? { edges: mergedEdges } : {}),
      ...(args.properties !== undefined ? { properties: args.properties } : {}),
      ...(args.searchMetaVector !== undefined ? { searchMetaVector: args.searchMetaVector } : {}),
      ...(args.attachScopes !== undefined && args.attachScopes.length > 0
        ? { attachScopes: args.attachScopes }
        : {}),
    } as Parameters<MemoriesClient<TNode, TEdge>["mergeMemory"]>[0]),
  );
}
