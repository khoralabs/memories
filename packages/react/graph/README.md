# @khoralabs/memories-react-graph

React components for exploring a memories knowledge graph in 3D: hybrid search, namespace selection, memory preview, and an optional investigator Q&A overlay.

Built on **React 19**, **@react-three/fiber**, and **three.js**. The package does **not** open a database by itself — mount `MemoriesClientProvider` with a `ReactMemoriesClient` (or `createClient` factory for database switching), then namespaces + memory providers for catalog/focus/CRUD.

## Exports

| Export | Role |
|--------|------|
| `MemoriesClientProvider` / `useMemoriesClient` / `useMemoriesDatabase` | Client + database focus + resolved ontology |
| `MemoriesNamespacesProvider` / `useMemoriesNamespaces` | Namespace catalog, focus, create/rename/metadata/delete |
| `MemoriesMemoryProvider` / `useMemoriesMemory` | Scope-sensitive graph catalog, search, memory focus, create/update/remove |
| `createServiceReactMemoriesClient` / `ReactMemoriesClient` | Service HTTP client + interface |
| `GraphScene` | 3D graph canvas with nodes, edges, focus/hover |
| `GraphProjectionProvider` / `useProjection` | Scene projection + chrome (reads payload/search/focus from memory provider) |
| `GraphSearch` | Search input with hybrid query + optional deep-search toggle |
| `GraphNamespaceSelector` / `GraphNamespaceTree` | Namespace picker / tree (read namespaces context) |
| `AddNamespaceButton` / `AddMemoryButton` / `RefreshGraphButton` | Compound chrome buttons (`.Tooltip` + `Button` props) |
| `GraphInvestigatorProvider` / `GraphInvestigatorAnswer` | Investigator Q&A overlay (requires a `GraphInvestigatorClient`) |
| `createSyncInvestigatorClient` / `createJobStreamInvestigatorClient` | Sync POST or job+SSE investigator transports |
| `GraphPreviewDock` | Selected memory preview panel |
| `GraphLoading`, `GraphFetchError` | Loading and error states |

Peer dependencies: `react`, `react-dom`, `three`, `@react-three/fiber`, `@react-three/drei`, `@react-three/postprocessing` (used when `fog.blur` is enabled for screen-space edge softening).

## Host integration

1. Point at memories-service (`createServiceReactMemoriesClient`) or implement `ReactMemoriesClient`.
2. Mount `MemoriesClientProvider` → `MemoriesNamespacesProvider` → `MemoriesMemoryProvider` → `GraphProjectionProvider`.
3. Hosts own create forms; call `useMemoriesNamespaces().create` / `useMemoriesMemory().create`. Use `AddNamespaceButton` / `AddMemoryButton` as chrome triggers only (wire `onClick`).
4. The memory catalog follows namespaces `scope` (`exact` vs `subtree`). Search uses the same scope via `useMemoriesMemory`.

```tsx
import {
  AddMemoryButton,
  AddNamespaceButton,
  createServiceReactMemoriesClient,
  GraphProjectionProvider,
  GraphScene,
  GraphSearch,
  MemoriesClientProvider,
  MemoriesMemoryProvider,
  MemoriesNamespacesProvider,
  useMemoriesMemory,
  useMemoriesNamespaces,
} from "@khoralabs/memories-react-graph";

const database = { kind: "account" as const, ownerKey: "user-1" };
const createClient = (db: typeof database) =>
  createServiceReactMemoriesClient({
    baseUrl: "https://memories.example",
    database: db,
  });

function CreateMemoryControl() {
  const { create } = useMemoriesMemory();
  return (
    <AddMemoryButton
      onClick={() => {
        const key = window.prompt("Memory key");
        if (!key) return;
        void create({
          kind: "node",
          key,
          content: [{ key: "body", text: "…" }],
        });
      }}
    />
  );
}

function CreateNamespaceControl({ parent }: { parent?: string }) {
  const { create, validateSegment } = useMemoriesNamespaces();
  return (
    <AddNamespaceButton
      onClick={() => {
        const name = window.prompt("Namespace name");
        if (!name) return;
        if (validateSegment(name)) return;
        void create({ parent, name });
      }}
    />
  );
}

function MemoriesGraphPage() {
  return (
    <MemoriesClientProvider createClient={createClient} database={database}>
      <MemoriesNamespacesProvider namespace="global" scope="subtree">
        <MemoriesMemoryProvider>
          <GraphProjectionProvider>
            <CreateNamespaceControl />
            <CreateMemoryControl />
            <GraphScene />
            <GraphSearch />
          </GraphProjectionProvider>
        </MemoriesMemoryProvider>
      </MemoriesNamespacesProvider>
    </MemoriesClientProvider>
  );
}
```

### Investigator client

`GraphInvestigatorProvider` is transport-agnostic: pass a `GraphInvestigatorClient` that starts an investigation and reports progress, completion, or errors via callbacks.

```tsx
import {
  GraphInvestigatorProvider,
  createSyncInvestigatorClient,
  createServiceReactMemoriesClient,
  MemoriesMemoryProvider,
} from "@khoralabs/memories-react-graph";

const memoriesClient = createServiceReactMemoriesClient({
  baseUrl: "https://memories.example",
  database: { kind: "account", ownerKey: "user-1" },
  investigate: async ({ namespace, question }) => {
    return { answer: "…" };
  },
});
const investigatorClient = createSyncInvestigatorClient({ client: memoriesClient });

<MemoriesClientProvider client={memoriesClient}>
  <MemoriesNamespacesProvider>
    <MemoriesMemoryProvider>
      <GraphInvestigatorProvider client={investigatorClient}>
        <GraphSearch />
        <GraphInvestigatorAnswerOverlay />
      </GraphInvestigatorProvider>
    </MemoriesMemoryProvider>
  </MemoriesNamespacesProvider>
</MemoriesClientProvider>
```

For async job + SSE backends, use `createJobStreamInvestigatorClient` with host-specific `startJob`, `streamUrl`, and `parseEvent` hooks.

## Development

```bash
bun run typecheck   # from this package
```

Included in the root `bun run typecheck` workspace script.
