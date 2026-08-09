import { mock } from "bun:test";

import type { ReactMemoriesClient } from "../memories-client.js";
import type { GraphPayload } from "../projection-types.js";

export const TEST_DATABASE = { kind: "account" as const, ownerKey: "test" };

export function emptyGraph(namespace = "acme"): GraphPayload {
  return { namespace, nodes: [], edges: [] };
}

/** Minimal {@link ReactMemoriesClient} with overridable methods for provider tests. */
export function createMockReactClient(
  overrides: Partial<ReactMemoriesClient> = {},
): ReactMemoriesClient {
  const client: ReactMemoriesClient = {
    listNamespaces: mock(async () => ({
      namespaces: [{ namespace: "acme", alias: null, description: "", suppressed: false }],
      namespaceRoot: "acme",
    })),
    getGraph: mock(async (input) => emptyGraph(input.namespace)),
    search: mock(async () => ({
      hitCount: 0,
      hitKeys: [],
      neighborKeys: [],
      keys: [],
      hitSnippets: [],
      edgeHitSnippets: [],
    })),
    searchNamespaces: mock(async () => ({
      query: "",
      under: null,
      namespaces: [],
    })),
    getEdgePreview: mock(async () => ({})),
    upsertNamespace: mock(async (input) => ({
      namespace: input.namespace,
      alias: input.alias ?? null,
      description: input.description ?? "",
      suppressed: false,
    })),
    getNamespaceMetadata: mock(async () => null),
    renameNamespace: mock(async () => ({ namespaces: [], renamedMemories: 0 })),
    deleteNamespace: mock(async () => ({ namespaces: [], deletedMemories: 0 })),
    suppressNamespace: mock(async () => {}),
    unsuppressNamespace: mock(async () => {}),
    mergeMemory: mock(async () => ({ memoryIds: [] })),
    deleteMemory: mock(async () => {}),
    getMemoryPreview: mock(async () => ({
      key: "",
      namespace: "",
      labels: [],
      content: [],
      suppressed: false,
    })),
    ...overrides,
  };
  return client;
}
