import type { OntologyLabelInstance } from "@khoralabs/memories-core";

/** Dimension for hashing ontology labels + JSON properties into a dense sketch. */
export const LABEL_PROPERTY_SYNTH_DIM = 32;

function fnv1a(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function addSketchFeature(vec: number[], dim: number, feature: string): void {
  if (!feature) return;
  const h1 = fnv1a(feature);
  const h2 = fnv1a(`${feature}\0#`);
  const i1 = dim > 0 ? h1 % dim : 0;
  const i2 = dim > 0 ? h2 % dim : 0;
  const mag = 1 / Math.sqrt(dim);
  const s1 = (h1 & 1) === 0 ? mag : -mag;
  const s2 = (h2 & 1) === 0 ? mag * 0.5 : -mag * 0.5;
  const a = vec[i1] ?? 0;
  vec[i1] = a + s1;
  if (i2 !== i1) {
    const b = vec[i2] ?? 0;
    vec[i2] = b + s2;
  }
}

function sortedPropertyStrings(props: Record<string, unknown>): string[] {
  const keys = Object.keys(props).sort();
  const out: string[] = [];
  for (const k of keys) {
    out.push(`${k}=${JSON.stringify(props[k])}`);
  }
  return out;
}

/**
 * Deterministic, fixed-length sketch of node ontology labels and optional JSON properties
 * for use alongside mean-pooled vector embeddings in UMAP.
 */
export function labelPropertySyntheticEmbedding(
  labels: readonly OntologyLabelInstance[],
  properties: Record<string, unknown> | null | undefined,
  dim: number = LABEL_PROPERTY_SYNTH_DIM,
): number[] {
  const vec = new Array(dim).fill(0);
  for (const lb of labels) {
    const p = lb.props ?? {};
    addSketchFeature(vec, dim, `label:${lb.kind}`);
    for (const s of sortedPropertyStrings(p)) {
      addSketchFeature(vec, dim, `labelProp:${lb.kind}:${s}`);
    }
  }
  if (properties && typeof properties === "object") {
    for (const s of sortedPropertyStrings(properties)) {
      addSketchFeature(vec, dim, `prop:${s}`);
    }
  }
  let sumsq = 0;
  for (const x of vec) sumsq += x * x;
  const norm = Math.sqrt(sumsq) || 1;
  return vec.map((x) => x / norm);
}
