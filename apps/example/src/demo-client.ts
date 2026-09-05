import type { ReactMemoriesClient } from "@/components/memories/memories-client";
import type { GraphPayload } from "@/components/memories/projection-types";

const DEMO_NS = "demo";

function sampleGraph(namespace: string): GraphPayload {
  return {
    namespace,
    nodes: [
      {
        key: "alpha",
        x: -0.4,
        y: 0.1,
        z: 0,
        labels: [{ kind: "Entity", props: { name: "Alpha" } }],
        degree: { count: 1, centrality: 1 },
        suppressed: false,
      },
      {
        key: "beta",
        x: 0.4,
        y: -0.1,
        z: 0.2,
        labels: [{ kind: "Entity", props: { name: "Beta" } }],
        degree: { count: 1, centrality: 1 },
        suppressed: false,
      },
    ],
    edges: [
      {
        edgeId: "e1",
        fromKey: "alpha",
        toKey: "beta",
        labels: [{ kind: "related_to", props: {} }],
        directed: true,
        suppressed: false,
      },
    ],
  };
}

/** In-memory {@link ReactMemoriesClient} for registry smoke (no service). */
export function createDemoMemoriesClient(): ReactMemoriesClient {
  return {
    async listNamespaces() {
      return {
        namespaces: [
          { namespace: DEMO_NS, alias: "Demo", description: "Registry smoke", suppressed: false },
        ],
        namespaceRoot: DEMO_NS,
      };
    },
    async getGraph(input) {
      return sampleGraph(input.namespace || DEMO_NS);
    },
    async getGraphCounts(input) {
      const g = sampleGraph(input.namespace);
      return {
        namespace: g.namespace,
        scope: input.scope ?? "exact",
        nodeCount: g.nodes.length,
        edgeCount: g.edges.length,
      };
    },
    async getGraphStats(input) {
      const counts = await this.getGraphCounts(input);
      return {
        ...counts,
        suppressedNodeCount: 0,
        suppressedEdgeCount: 0,
        labelKinds: { nodes: { Entity: 2 }, edges: { related_to: 1 } },
      };
    },
    async search() {
      return {
        hitCount: 0,
        hitKeys: [],
        neighborKeys: [],
        keys: [],
        hitSnippets: [],
        edgeHitSnippets: [],
      };
    },
    async searchNamespaces(input) {
      return { query: input.query, under: input.under ?? null, namespaces: [] };
    },
    async getEdgePreview(input) {
      return {
        edgeId: input.edgeId,
        fromKey: "alpha",
        toKey: "beta",
        labels: [{ kind: "related_to", props: {} }],
        properties: null,
        suppressed: false,
      };
    },
    async upsertNamespace(input) {
      return {
        namespace: input.namespace,
        alias: input.alias ?? null,
        description: input.description ?? "",
        suppressed: false,
      };
    },
    async getNamespaceMetadata() {
      return null;
    },
    async renameNamespace() {
      return { namespaces: [], renamedMemories: 0 };
    },
    async deleteNamespace() {
      return { namespaces: [], deletedMemories: 0 };
    },
    async suppressNamespace() {},
    async unsuppressNamespace() {},
    async mergeMemory() {
      return { memoryIds: [] };
    },
    async replaceFeature() {
      return { sourceMapId: "sm", rootHex: "00" };
    },
    async deleteMemory() {},
    async getMemoryPreview(input) {
      return {
        key: input.key,
        namespace: input.namespace,
        labels: [{ kind: "Entity", props: { name: input.key } }],
        content: [
          {
            sourceKey: "body",
            sourceMapId: "sm1",
            text: `Demo memory ${input.key}`,
            hasText: true,
            hasVector: false,
            createdAt: Date.now(),
          },
        ],
        properties: null,
        suppressed: false,
      };
    },
    async getMemoryDetail(input) {
      const preview = await this.getMemoryPreview(input);
      return {
        preview,
        atTip: { content: null, graph: null, vectors: null },
        events: { events: [] },
      };
    },
    async getEdgeDetail(input) {
      const preview = await this.getEdgePreview(input);
      return {
        preview: {
          edgeId: input.edgeId,
          fromKey: preview.fromKey ?? "alpha",
          toKey: preview.toKey ?? "beta",
          labels: preview.labels,
          properties: preview.properties ?? null,
          suppressed: false,
        },
        atTip: { content: null, graph: null, vectors: null },
        events: { events: [] },
      };
    },
    async getProvenanceGraph() {
      return { rootHex: "", graph: null };
    },
    async getProvenanceVectors() {
      return { rootHex: "", vectors: [] };
    },
    async getBackendCapabilities() {
      return { tipReplayAtRootHex: false };
    },
    async getSourceMapText() {
      return null;
    },
    async listProvenanceEvents() {
      return [];
    },
    async listProvenanceChain() {
      return [];
    },
    async getMemoryContentAtRootHex() {
      return [];
    },
  };
}

export const DEMO_DATABASE = { kind: "account" as const, ownerKey: "demo" };
