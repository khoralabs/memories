import type { GraphProjectionGraphReads, GraphProjectionSource } from "../source";
import type { NamespaceGraphLayout } from "./layout-types";
import { collectNamespaceProjectionInput } from "./projection-input";
import { buildNamespaceGraphLayoutFromProjectionInput } from "./projection-input-layout";
import type { Umap3DLayoutOptions } from "./umap-layout";

/**
 * Loads graph topology and projection source rows, then builds a normalized namespace layout.
 */
export async function buildNamespaceGraphLayoutFromSource(
  source: GraphProjectionSource,
  persistence: GraphProjectionGraphReads,
  namespace: string,
  umapOptions?: Umap3DLayoutOptions,
): Promise<NamespaceGraphLayout> {
  const input = await collectNamespaceProjectionInput(source, persistence, namespace);
  return buildNamespaceGraphLayoutFromProjectionInput(input, umapOptions);
}
