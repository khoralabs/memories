import type { GraphProjectionGraphReads, GraphProjectionSource } from "../source";
import type { NamespaceGraphLayout } from "./layout-types";
import { collectNamespaceProjectionInput } from "./projection-input";
import { buildNamespaceGraphLayoutFromProjectionInput } from "./projection-input-layout";
import type { Umap3DLayoutOptions } from "./umap-layout";

export async function buildNamespaceSubtreeGraphLayoutFromSource(
  source: GraphProjectionSource,
  persistence: GraphProjectionGraphReads,
  prefix: string,
  umapOptions?: Umap3DLayoutOptions,
): Promise<NamespaceGraphLayout> {
  const input = await collectNamespaceProjectionInput(source, persistence, prefix, {
    scope: "subtree",
  });
  return buildNamespaceGraphLayoutFromProjectionInput(input, umapOptions);
}
