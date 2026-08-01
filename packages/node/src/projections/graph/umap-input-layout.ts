import { buildNamespaceGraphLayoutFromRows } from "./layout-core";
import type { NamespaceGraphLayout } from "./layout-types";
import type { NamespaceUmapInput } from "./umap-input";
import type { Umap3DLayoutOptions } from "./umap-layout";

function deserializeMap<T>(entries: Array<[string, T]>): Map<string, T> {
  return new Map(entries);
}

export type BuildLayoutFromUmapInputOptions = {
  umapOptions?: Umap3DLayoutOptions;
  /**
   * When false (default), omit suppressed entities from layout positions.
   * When true, include them and mark `suppressed` on layout nodes/edges.
   */
  includeSuppressed?: boolean;
};

function resolveLayoutOpts(
  umapOptionsOrOpts?: Umap3DLayoutOptions | BuildLayoutFromUmapInputOptions,
): BuildLayoutFromUmapInputOptions {
  if (umapOptionsOrOpts === undefined) return {};
  if ("umapOptions" in umapOptionsOrOpts || "includeSuppressed" in umapOptionsOrOpts) {
    return umapOptionsOrOpts as BuildLayoutFromUmapInputOptions;
  }
  return { umapOptions: umapOptionsOrOpts as Umap3DLayoutOptions };
}

export function buildNamespaceGraphLayoutFromUmapInput(
  input: NamespaceUmapInput,
  umapOptionsOrOpts?: Umap3DLayoutOptions | BuildLayoutFromUmapInputOptions,
): NamespaceGraphLayout {
  const opts = resolveLayoutOpts(umapOptionsOrOpts);
  return buildNamespaceGraphLayoutFromRows({
    namespace: input.namespace,
    edges: input.edges,
    embeddings: input.embeddings,
    labelsByKey: deserializeMap(input.labelsByKey),
    propertiesByKey: deserializeMap(input.propertiesByKey),
    umapOptions: opts.umapOptions,
    includeSuppressed: opts.includeSuppressed === true,
    suppressedKeys: input.suppressedKeys ?? [],
  });
}
