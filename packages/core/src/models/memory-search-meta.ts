import type { OntologyLabelInstance } from "./ontology-label";

export {
  isSystemSearchMetaSourceKey,
  MEMORY_SEARCH_META_SOURCE_KEY,
} from "../search-meta-constants";

function sortUnique(xs: string[]): string[] {
  return [...new Set(xs)].sort((a, b) => a.localeCompare(b));
}

function formatNodeLines(labelKinds: string[]): string[] {
  return sortUnique(labelKinds).map((l) => `node:${l}`);
}

function formatEdgeLine(
  direction: "in" | "out",
  neighborKey: string,
  edgeLabelKinds: string[],
): string {
  const joined = sortUnique(edgeLabelKinds).join("|");
  return `edge ${direction}:${neighborKey}:${joined}`;
}

/** Build the same canonical multiline string as DB/search-meta text from merge payload (pre-DB). */
export function buildCanonicalMemorySearchMetaTextForMerge(input: {
  labels: OntologyLabelInstance[];
  /** Neighbor memory **key** (same string stored on `nodes.value`) for meta text lines only. */
  edges: Array<{ neighbor_key: string; direction: "in" | "out"; label: OntologyLabelInstance }>;
}): string {
  const nodeKinds = sortUnique(input.labels.map((l) => l.kind));
  const nodeLines = formatNodeLines(nodeKinds);
  const edgeLines = sortUnique(
    input.edges.map((e) => formatEdgeLine(e.direction, e.neighbor_key, [e.label.kind])),
  );
  const lines = [...nodeLines, ...edgeLines].sort((a, b) => a.localeCompare(b));
  return lines.join("\n");
}
