import { ids } from "../../../index.ts";
import {
  type LabelSchemaMap,
  type OntologyDefinition,
  validateEdgeLabel,
  validateNodeLabel,
} from "../../../ontology/index.ts";
import {
  decomposeLogicalMemoryToContent,
  type EmbeddingModel,
  mergeLogicalMemoryWithMergeSlice,
  type ProcessedLogicalMemory,
} from "../index.ts";
import type { AgentMemorySearchClient } from "./memory-search.ts";

export const AGENT_MEMORY_NODE_KIND = "Memory" as const;
export const AGENT_MEMORY_EDGE_KIND = "References" as const;

export type MemoryLinkInput = {
  namespace: string;
  key: string;
  direction?: "in" | "out";
  label?: string;
  props?: Record<string, unknown>;
};

export type WriteMemoryNodeInput = {
  namespace: string;
  key: string;
  text: string;
  links?: MemoryLinkInput[];
  nodeLabels?: Record<string, unknown>;
};

export type WriteMemoryIntegrateEnqueue = {
  baseUrl: string;
  token: string;
  ownerKey: string;
  writeScope?: "exact" | "under" | "cross";
  source?: string;
  memoriesContextRefs?: Record<string, unknown>;
};

export type WriteMemoryNodeOptions = {
  embeddingModel: EmbeddingModel;
  ontology: OntologyDefinition<LabelSchemaMap, LabelSchemaMap>;
  integrate?: WriteMemoryIntegrateEnqueue;
};

function defaultNodeLabels(
  ontology: OntologyDefinition<LabelSchemaMap, LabelSchemaMap>,
): Record<string, unknown> {
  if ("memory" in ontology.nodeLabels) return { memory: {} };
  if (AGENT_MEMORY_NODE_KIND in ontology.nodeLabels) {
    return { [AGENT_MEMORY_NODE_KIND]: {} };
  }
  const first = Object.keys(ontology.nodeLabels)[0];
  if (first === undefined) {
    throw new Error("ontology has no node label kinds");
  }
  return { [first]: {} };
}

function defaultEdgeKind(ontology: OntologyDefinition<LabelSchemaMap, LabelSchemaMap>): string {
  if ("references" in ontology.edgeLabels) return "references";
  if (AGENT_MEMORY_EDGE_KIND in ontology.edgeLabels) {
    return AGENT_MEMORY_EDGE_KIND;
  }
  const first = Object.keys(ontology.edgeLabels)[0];
  if (first === undefined) {
    throw new Error("ontology has no edge label kinds");
  }
  return first;
}

function buildValidatedLabels(
  ontology: OntologyDefinition<LabelSchemaMap, LabelSchemaMap>,
  nodeLabels: Record<string, unknown>,
): Array<{ kind: string; props: Record<string, unknown> }> {
  const labels: Array<{ kind: string; props: Record<string, unknown> }> = [];
  for (const [kind, props] of Object.entries(nodeLabels)) {
    if (props === undefined) continue;
    try {
      const validated = validateNodeLabel(ontology, {
        kind,
        props: (props ?? {}) as Record<string, unknown>,
      });
      labels.push({
        kind: validated.kind,
        props: validated.props as Record<string, unknown>,
      });
    } catch (err) {
      const detail =
        err instanceof Error && err.message.trim().length > 0 ? err.message.trim() : String(err);
      throw new Error(`writeMemory nodeLabels.${kind} invalid: ${detail}`);
    }
  }
  if (labels.length === 0) {
    throw new Error("writeMemory requires at least one ontology node label");
  }
  return labels;
}

async function enqueueMemoryIntegrate(
  integrate: WriteMemoryIntegrateEnqueue,
  args: { namespace: string; memoryKey: string; text: string },
): Promise<void> {
  const base = integrate.baseUrl.replace(/\/$/, "");
  const url = `${base}/api/memories/events`;
  const correlationId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `write-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const body = {
    kind: "memory" as const,
    ownerKey: integrate.ownerKey,
    namespace: args.namespace,
    memoryKey: args.memoryKey,
    writeScope: integrate.writeScope ?? "under",
    correlationId,
    occurredAtMs: Date.now(),
    payload: { source: integrate.source ?? "writeMemory" },
    features: { lexical: [args.text], vector: [] as number[][] },
    instructions: "",
    ...(integrate.memoriesContextRefs !== undefined
      ? { memoriesContextRefs: integrate.memoriesContextRefs }
      : {}),
  };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${integrate.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`[writeMemory] integrate enqueue failed: HTTP ${res.status} ${text}`);
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`[writeMemory] integrate enqueue failed: ${detail}`);
  }
}

export async function assertNamespaceWritableForAgent(
  client: AgentMemorySearchClient,
  namespace: string,
): Promise<void> {
  const getMeta = client.persistence.getNamespaceMetadata;
  if (getMeta === undefined) return;

  const segments = namespace.split("/").filter((part) => part.length > 0);
  let path = "";
  for (const segment of segments) {
    path = path.length === 0 ? segment : `${path}/${segment}`;
    const row = await getMeta.call(client.persistence, path);
    if (row?.suppressed === true) {
      const detail =
        path === namespace
          ? `namespace "${namespace}" is suppressed`
          : `namespace "${namespace}" is under suppressed ancestor "${path}"`;
      throw new Error(`Cannot write memory: ${detail}`);
    }
  }
}

export async function writeMemoryNode(
  client: AgentMemorySearchClient,
  input: WriteMemoryNodeInput,
  options: WriteMemoryNodeOptions,
): Promise<string[]> {
  const namespace = input.namespace.trim();
  const key = input.key.trim();
  const text = input.text;
  const { embeddingModel, ontology } = options;

  await assertNamespaceWritableForAgent(client, namespace);

  const nodeLabels =
    input.nodeLabels !== undefined && Object.keys(input.nodeLabels).length > 0
      ? input.nodeLabels
      : defaultNodeLabels(ontology);
  const labels = buildValidatedLabels(ontology, nodeLabels);
  const edgeKindDefault = defaultEdgeKind(ontology);

  const edges =
    input.links?.map((link) => {
      const kind = link.label?.trim() || edgeKindDefault;
      try {
        const validated = validateEdgeLabel(ontology, {
          kind,
          props: (link.props ?? {}) as Record<string, unknown>,
        });
        return {
          peer_memory_id: ids.memory(link.namespace.trim(), link.key.trim()),
          direction: (link.direction ?? "out") as "in" | "out",
          label: {
            kind: validated.kind,
            props: validated.props as Record<string, unknown>,
          },
        };
      } catch (err) {
        const detail =
          err instanceof Error && err.message.trim().length > 0 ? err.message.trim() : String(err);
        throw new Error(`writeMemory link edge "${kind}" invalid: ${detail}`);
      }
    }) ?? [];

  const content = await decomposeLogicalMemoryToContent({
    key,
    namespace,
    plaintext: text,
    embedding: { embeddingModel, multimodal: false },
  });
  const processed: ProcessedLogicalMemory = {
    key,
    namespace,
    plaintext: text,
    content,
  };

  await mergeLogicalMemoryWithMergeSlice(
    client as never,
    processed,
    {
      labels,
      ...(edges.length > 0 ? { edges } : {}),
    } as never,
    embeddingModel,
  );

  const memoryId = await client.persistence.findMemoryIdByKey(namespace, key);
  const memoryIds = typeof memoryId === "string" && memoryId.length > 0 ? [memoryId] : [];

  if (options.integrate !== undefined) {
    void enqueueMemoryIntegrate(options.integrate, {
      namespace,
      memoryKey: key,
      text,
    });
  }

  return memoryIds;
}
