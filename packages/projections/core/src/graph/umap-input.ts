import { promisify } from "node:util";
import { gunzip, gzip } from "node:zlib";
import type {
  GraphEdgeLink,
  GraphMemoryEmbedding,
  OntologyLabelInstance,
} from "@khoralabs/memories-persistence-core";
import type { GraphProjectionGraphReads, GraphProjectionSource } from "../source";
import { buildNamespaceGraphLayoutFromRows } from "./layout-core";
import type { GraphLayoutEdge, NamespaceGraphLayout } from "./layout-types";
import { qualifyMemoryKey } from "./qualified-memory-key";
import type { Umap3DLayoutOptions } from "./umap-layout";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

export const UMAP_INPUT_VERSION = 1;
export const UMAP_INPUT_CONTENT_TYPE = "application/vnd.khoralabs.memories.umap-input+json";
export const UMAP_INPUT_ENCODING_HEADER = "x-memories-payload-encoding";

export type UmapInputCompression = "gzip" | "none";
export type UmapInputScope = "exact" | "subtree";

export type NamespaceUmapInput = {
  version: typeof UMAP_INPUT_VERSION;
  namespace: string;
  scope: UmapInputScope;
  edges: GraphLayoutEdge[];
  embeddings: GraphMemoryEmbedding[];
  labelsByKey: Array<[string, OntologyLabelInstance[]]>;
  propertiesByKey: Array<[string, Record<string, unknown> | null]>;
  provenanceHeadRootHex?: string;
};

export type CollectUmapInputOptions = {
  scope?: UmapInputScope;
  provenanceHeadRootHex?: string;
};

export type EncodeUmapInputOptions = {
  compression?: UmapInputCompression;
};

export type DecodeUmapInputOptions = {
  compression?: UmapInputCompression;
  dangerousSkipValidation?: boolean;
};

function assertRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function assertString(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  return value;
}

function assertNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  return value;
}

function assertOptionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean`);
  return value;
}

function assertPlainObjectOrNull(value: unknown, label: string): Record<string, unknown> | null {
  if (value === null) return null;
  return assertRecord(value, label);
}

function validateLabel(value: unknown, label: string): OntologyLabelInstance {
  const record = assertRecord(value, label);
  const kind = assertString(record.kind, `${label}.kind`);
  const props = record.props === undefined ? {} : assertRecord(record.props, `${label}.props`);
  return { kind, props };
}

function validateLabels(value: unknown, label: string): OntologyLabelInstance[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value.map((item, i) => validateLabel(item, `${label}[${i}]`));
}

function validateGraphEdge(value: unknown, label: string): GraphLayoutEdge {
  const record = assertRecord(value, label);
  return {
    edgeId: assertString(record.edgeId, `${label}.edgeId`),
    fromKey: assertString(record.fromKey, `${label}.fromKey`),
    toKey: assertString(record.toKey, `${label}.toKey`),
    labels: validateLabels(record.labels, `${label}.labels`),
    ...(record.directed !== undefined
      ? { directed: assertOptionalBoolean(record.directed, `${label}.directed`) }
      : {}),
  };
}

function validateEmbedding(value: unknown, label: string): GraphMemoryEmbedding {
  const record = assertRecord(value, label);
  const embedding = record.embedding;
  if (!Array.isArray(embedding)) throw new Error(`${label}.embedding must be an array`);
  return {
    memoryKey: assertString(record.memoryKey, `${label}.memoryKey`),
    memoryId: assertString(record.memoryId, `${label}.memoryId`),
    embedding: embedding.map((item, i) => assertNumber(item, `${label}.embedding[${i}]`)),
  };
}

function validateTupleArray<T>(
  value: unknown,
  label: string,
  validateValue: (item: unknown, itemLabel: string) => T,
): Array<[string, T]> {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value.map((entry, i) => {
    if (!Array.isArray(entry) || entry.length !== 2) {
      throw new Error(`${label}[${i}] must be a [key, value] tuple`);
    }
    return [
      assertString(entry[0], `${label}[${i}][0]`),
      validateValue(entry[1], `${label}[${i}][1]`),
    ];
  });
}

export function validateUmapInput(value: unknown): NamespaceUmapInput {
  const record = assertRecord(value, "NamespaceUmapInput");
  if (record.version !== UMAP_INPUT_VERSION) {
    throw new Error(`NamespaceUmapInput.version must be ${UMAP_INPUT_VERSION}`);
  }
  const scope = record.scope;
  if (scope !== "exact" && scope !== "subtree") {
    throw new Error('NamespaceUmapInput.scope must be "exact" or "subtree"');
  }
  const input: NamespaceUmapInput = {
    version: UMAP_INPUT_VERSION,
    namespace: assertString(record.namespace, "NamespaceUmapInput.namespace"),
    scope,
    edges: Array.isArray(record.edges)
      ? record.edges.map((edge, i) => validateGraphEdge(edge, `NamespaceUmapInput.edges[${i}]`))
      : (() => {
          throw new Error("NamespaceUmapInput.edges must be an array");
        })(),
    embeddings: Array.isArray(record.embeddings)
      ? record.embeddings.map((embedding, i) =>
          validateEmbedding(embedding, `NamespaceUmapInput.embeddings[${i}]`),
        )
      : (() => {
          throw new Error("NamespaceUmapInput.embeddings must be an array");
        })(),
    labelsByKey: validateTupleArray(
      record.labelsByKey,
      "NamespaceUmapInput.labelsByKey",
      validateLabels,
    ),
    propertiesByKey: validateTupleArray(
      record.propertiesByKey,
      "NamespaceUmapInput.propertiesByKey",
      assertPlainObjectOrNull,
    ),
  };
  if (record.provenanceHeadRootHex !== undefined) {
    input.provenanceHeadRootHex = assertString(
      record.provenanceHeadRootHex,
      "NamespaceUmapInput.provenanceHeadRootHex",
    );
  }
  return input;
}

function toLayoutEdge(edge: GraphEdgeLink): GraphLayoutEdge {
  return {
    edgeId: edge.edgeId,
    fromKey: edge.fromKey,
    toKey: edge.toKey,
    labels: edge.labels,
    directed: edge.directed,
  };
}

function serializeMap<T>(map: Map<string, T>): Array<[string, T]> {
  return [...map.entries()];
}

function deserializeMap<T>(entries: Array<[string, T]>): Map<string, T> {
  return new Map(entries);
}

function qualifyEdges(namespace: string, edges: GraphEdgeLink[]): GraphLayoutEdge[] {
  return edges.map((edge) => ({
    edgeId: qualifyMemoryKey(namespace, edge.edgeId),
    fromKey: qualifyMemoryKey(namespace, edge.fromKey),
    toKey: qualifyMemoryKey(namespace, edge.toKey),
    labels: edge.labels,
    directed: edge.directed,
  }));
}

function qualifyEmbeddings(
  namespace: string,
  rows: GraphMemoryEmbedding[],
): GraphMemoryEmbedding[] {
  return rows.map((row) => ({
    ...row,
    memoryKey: qualifyMemoryKey(namespace, row.memoryKey),
  }));
}

function qualifyMap<T>(namespace: string, rows: Map<string, T>): Map<string, T> {
  const out = new Map<string, T>();
  for (const [key, value] of rows) {
    out.set(qualifyMemoryKey(namespace, key), value);
  }
  return out;
}

export async function collectNamespaceUmapInput(
  source: GraphProjectionSource,
  graphReads: GraphProjectionGraphReads,
  namespace: string,
  options: CollectUmapInputOptions = {},
): Promise<NamespaceUmapInput> {
  const scope = options.scope ?? "exact";
  if (scope === "subtree") {
    const namespaces = await source.listNamespacesUnderPrefix(namespace);
    const chunks = await Promise.all(
      namespaces.map(async (namespace) => {
        const [edges, embeddings, labelsByKey, propertiesByKey] = await Promise.all([
          graphReads.loadGraphEdgesForNamespace(namespace),
          source.loadMeanEmbeddingsForNamespace(namespace),
          graphReads.loadNodeLabelsForNamespace(namespace),
          graphReads.loadNodePropertiesForNamespace(namespace),
        ]);
        return {
          edges: qualifyEdges(namespace, edges),
          embeddings: qualifyEmbeddings(namespace, embeddings),
          labelsByKey: qualifyMap(namespace, labelsByKey),
          propertiesByKey: qualifyMap(namespace, propertiesByKey),
        };
      }),
    );

    const labelsByKey = new Map<string, OntologyLabelInstance[]>();
    const propertiesByKey = new Map<string, Record<string, unknown> | null>();
    for (const chunk of chunks) {
      for (const [key, labels] of chunk.labelsByKey) labelsByKey.set(key, labels);
      for (const [key, props] of chunk.propertiesByKey) propertiesByKey.set(key, props);
    }

    return {
      version: UMAP_INPUT_VERSION,
      namespace,
      scope,
      edges: chunks.flatMap((chunk) => chunk.edges),
      embeddings: chunks.flatMap((chunk) => chunk.embeddings),
      labelsByKey: serializeMap(labelsByKey),
      propertiesByKey: serializeMap(propertiesByKey),
      ...(options.provenanceHeadRootHex !== undefined
        ? { provenanceHeadRootHex: options.provenanceHeadRootHex }
        : {}),
    };
  }

  const [edges, embeddings, labelsByKey, propertiesByKey] = await Promise.all([
    graphReads.loadGraphEdgesForNamespace(namespace),
    source.loadMeanEmbeddingsForNamespace(namespace),
    graphReads.loadNodeLabelsForNamespace(namespace),
    graphReads.loadNodePropertiesForNamespace(namespace),
  ]);
  return {
    version: UMAP_INPUT_VERSION,
    namespace,
    scope: "exact",
    edges: edges.map(toLayoutEdge),
    embeddings,
    labelsByKey: serializeMap(labelsByKey),
    propertiesByKey: serializeMap(propertiesByKey),
    ...(options.provenanceHeadRootHex !== undefined
      ? { provenanceHeadRootHex: options.provenanceHeadRootHex }
      : {}),
  };
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

export async function encodeUmapInput(
  input: NamespaceUmapInput,
  options: EncodeUmapInputOptions = {},
): Promise<Uint8Array> {
  const compression = options.compression ?? "gzip";
  const json = JSON.stringify(input);
  const bytes = new TextEncoder().encode(json);
  if (compression === "none") return bytes;
  if (compression !== "gzip") throw new Error(`Unsupported UMAP input compression: ${compression}`);
  return new Uint8Array(await gzipAsync(bytes));
}

export async function decodeUmapInput(
  bytes: Uint8Array | ArrayBuffer,
  options: DecodeUmapInputOptions = {},
): Promise<NamespaceUmapInput> {
  const compression = options.compression ?? "gzip";
  const inputBytes = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
  const jsonBytes =
    compression === "none"
      ? inputBytes
      : compression === "gzip"
        ? new Uint8Array(await gunzipAsync(inputBytes))
        : (() => {
            throw new Error(`Unsupported UMAP input compression: ${compression}`);
          })();
  const parsed = JSON.parse(new TextDecoder().decode(jsonBytes)) as unknown;
  return options.dangerousSkipValidation
    ? (parsed as NamespaceUmapInput)
    : validateUmapInput(parsed);
}
