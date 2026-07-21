import type { LabelSchemaMap, NodeLabelInstance } from "@khoralabs/memories-ontologies";
import type {
  MemoriesClient,
  MemoriesClientAsync,
  MergeMemoryParamsNode,
  NamespacePath,
  SearchContent,
  SearchHit,
  SearchParams,
} from "../core/index";
import { type ComputeLexicalLinkOptions, computeLexicalLinkMergeSlice } from "./planner.js";
import { normalizeSearchConfigSnapshot } from "./search-config.js";

export type IntegrateNewMemoryArgs<
  TNode extends LabelSchemaMap = LabelSchemaMap,
  TEdge extends LabelSchemaMap = LabelSchemaMap,
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

export type AutolinkIntegrateDeps<
  TNode extends LabelSchemaMap = LabelSchemaMap,
  TEdge extends LabelSchemaMap = LabelSchemaMap,
> = {
  client: MemoriesClient<TNode, TEdge> | MemoriesClientAsync<TNode, TEdge>;
};

/**
 * Search → lexical link patch → merge. Pure of Workflow directives; call from a step
 * or directly in tests.
 *
 * Requires a merged ontology that includes the retrieval similarity ontology kinds.
 */
export async function runAutolinkIntegrate<
  TNode extends LabelSchemaMap,
  TEdge extends LabelSchemaMap,
>(
  args: IntegrateNewMemoryArgs<TNode, TEdge>,
  deps: AutolinkIntegrateDeps<TNode, TEdge>,
): Promise<string[]> {
  const { client } = deps;
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

  const { hits }: { hits: SearchHit[] } = await Promise.resolve(
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

/**
 * @deprecated Prefer {@link runAutolinkIntegrate} or the durable `autolinkIntegrate` workflow.
 */
export async function integrateNewMemoryIntoGraph<
  TNode extends LabelSchemaMap,
  TEdge extends LabelSchemaMap,
>(
  client: MemoriesClient<TNode, TEdge> | MemoriesClientAsync<TNode, TEdge>,
  args: IntegrateNewMemoryArgs<TNode, TEdge>,
): Promise<string[]> {
  return runAutolinkIntegrate(args, { client });
}
