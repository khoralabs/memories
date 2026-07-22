import { buildNamespaceGraphLayoutFromRows } from "./layout-core";
import type { NamespaceGraphLayout } from "./layout-types";
import type { NamespaceUmapInput } from "./umap-input";
import type { Umap3DLayoutOptions } from "./umap-layout";

function deserializeMap<T>(entries: Array<[string, T]>): Map<string, T> {
  return new Map(entries);
}

export function buildNamespaceGraphLayoutFromUmapInput(
  input: NamespaceUmapInput,
  umapOptions?: Umap3DLayoutOptions,
): NamespaceGraphLayout {
  return buildNamespaceGraphLayoutFromRows({
    namespace: input.namespace,
    edges: input.edges,
    embeddings: input.embeddings,
    labelsByKey: deserializeMap(input.labelsByKey),
    propertiesByKey: deserializeMap(input.propertiesByKey),
    umapOptions,
  });
}
