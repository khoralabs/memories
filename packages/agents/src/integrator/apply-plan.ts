import type {
  MemoriesClient,
  MemoriesClientAsync,
  MemoryMutationAttribution,
  MergeMemoryParamsNode,
} from "@khoralabs/memories-node";
import type { LabelSchemaMap } from "@khoralabs/memories-node/ontology";
import { type IntegratorPlanWire, parseIntegratorPlanWire } from "./integrator-output.js";
import { integratorWireToMergeSlice } from "./to-merge-slice.js";

type MergeSlice<TNode extends LabelSchemaMap, TEdge extends LabelSchemaMap> = Pick<
  MergeMemoryParamsNode<TNode, TEdge>,
  "labels" | "edges" | "properties"
>;

/**
 * Drops integrator edges whose peer is not an existing memory in `namespace`, and rewrites
 * `peer_memory_id` from memory key → resolved `_id` (merge expects ids, not keys).
 */
export async function filterMergeSliceEdgesToExistingMemories<
  TNode extends LabelSchemaMap,
  TEdge extends LabelSchemaMap,
>(
  client: MemoriesClient<TNode, TEdge> | MemoriesClientAsync<TNode, TEdge>,
  namespace: string,
  slice: MergeSlice<TNode, TEdge>,
): Promise<MergeSlice<TNode, TEdge>> {
  if (slice.edges === undefined || slice.edges.length === 0) {
    return slice;
  }
  const kept: NonNullable<MergeSlice<TNode, TEdge>["edges"]> = [];
  for (const e of slice.edges) {
    const id = await client.persistence.findMemoryIdByKey(namespace, e.peer_memory_id);
    if (id !== undefined) {
      kept.push({ ...e, peer_memory_id: id });
    }
  }
  return { ...slice, edges: kept.length > 0 ? kept : undefined };
}

/**
 * Applies an integrator plan (wire object or unparsed JSON) via `mergeMemory` — no ToolLoop / AI SDK.
 * Search-meta vectors are not refreshed; use `processLogicalMemoryWithIntegrator` for that.
 */
export async function applyIntegratorPlanToMerge<
  TNode extends LabelSchemaMap,
  TEdge extends LabelSchemaMap,
>(args: {
  client: MemoriesClient<TNode, TEdge> | MemoriesClientAsync<TNode, TEdge>;
  namespace: string;
  key: string;
  /** Memory text; stored as one content item keyed `text`. */
  content: string;
  plan: IntegratorPlanWire | unknown;
  attribution?: MemoryMutationAttribution;
}): Promise<IntegratorPlanWire> {
  const { client, namespace, key } = args;
  const plan = parseIntegratorPlanWire(client.ontology, args.plan);
  const slice = await filterMergeSliceEdgesToExistingMemories(
    client,
    namespace,
    integratorWireToMergeSlice(client.ontology, plan),
  );
  await client.mergeMemory({
    key,
    namespace,
    content: [{ key: "text", text: args.content }],
    ...slice,
    ...(args.attribution !== undefined ? { attribution: args.attribution } : {}),
  });
  return plan;
}
