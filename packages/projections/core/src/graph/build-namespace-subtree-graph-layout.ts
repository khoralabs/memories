import type { GraphProjectionGraphReads, GraphProjectionSource } from "../source";
import type { NamespaceGraphLayout } from "./layout-types";
import {
  buildNamespaceGraphLayoutFromUmapInput,
  collectNamespaceSubtreeUmapInput,
} from "./umap-input";
import type { Umap3DLayoutOptions } from "./umap-layout";

export async function buildNamespaceSubtreeGraphLayoutFromSource(
  source: GraphProjectionSource,
  persistence: GraphProjectionGraphReads,
  prefix: string,
  umapOptions?: Umap3DLayoutOptions,
): Promise<NamespaceGraphLayout> {
  const input = await collectNamespaceSubtreeUmapInput(source, persistence, prefix);
  return buildNamespaceGraphLayoutFromUmapInput(input, umapOptions);
}
