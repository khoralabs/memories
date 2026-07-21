import type { GraphProjectionGraphReads, GraphProjectionSource } from "../source";
import type { NamespaceGraphLayout } from "./layout-types";
import { buildNamespaceGraphLayoutFromUmapInput, collectNamespaceUmapInput } from "./umap-input";
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
  const input = await collectNamespaceUmapInput(source, persistence, namespace);
  return buildNamespaceGraphLayoutFromUmapInput(input, umapOptions);
}
