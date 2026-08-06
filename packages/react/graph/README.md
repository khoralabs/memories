# @khoralabs/memories-react-graph

React components for exploring a memories knowledge graph in 3D: hybrid search, namespace selection, memory preview, and an optional investigator Q&A overlay.

Built on **React 19**, **@react-three/fiber**, and **three.js**. The package does **not** open a database — the host injects a `ReactMemoriesClient` via `MemoriesClientProvider`, then mounts `MemoriesNamespacesProvider` for catalog/focus/CRUD.

## Exports

| Export | Role |
|--------|------|
| `MemoriesClientProvider` / `useMemoriesClient` | Injected graph backend client |
| `MemoriesNamespacesProvider` / `useMemoriesNamespaces` | Namespace catalog, focus, create/rename/metadata/delete |
| `createServiceReactMemoriesClient` / `ReactMemoriesClient` | Service HTTP client + interface |
| `GraphScene` | 3D graph canvas with nodes, edges, focus/hover |
| `GraphProjectionProvider` / `useProjection` | Projection + graph/search chrome (reads focus from namespaces) |
| `GraphSearch` | Search input with hybrid query + optional deep-search toggle |
| `GraphNamespaceSelector` / `GraphNamespaceTree` | Namespace picker / tree (read namespaces context) |
| `AddNamespaceButton` / `RefreshGraphButton` | Compound chrome buttons (`.Tooltip` + `Button` props) |
| `GraphInvestigatorProvider` / `GraphInvestigatorAnswer` | Investigator Q&A overlay (requires a `GraphInvestigatorClient`) |
| `createSyncInvestigatorClient` / `createJobStreamInvestigatorClient` | Sync POST or job+SSE investigator transports |
| `GraphPreviewDock` | Selected memory preview panel |
| `GraphLoading`, `GraphFetchError` | Loading and error states |

Peer dependencies: `react`, `react-dom`, `three`, `@react-three/fiber`, `@react-three/drei`, `@react-three/postprocessing` (used when `fog.blur` is enabled for screen-space edge softening).

## Host integration

1. Point at memories-service (`createServiceReactMemoriesClient`) or implement `ReactMemoriesClient`.
2. Mount `MemoriesClientProvider` → `MemoriesNamespacesProvider` → `GraphProjectionProvider`.
3. Hosts own create/rename forms; call `useMemoriesNamespaces().create` / `.rename` / `.updateMetadata` / `.remove`. Use `AddNamespaceButton` as a chrome trigger only (wire `onClick`).

```tsx
import {
  AddNamespaceButton,
  createServiceReactMemoriesClient,
  GraphProjectionProvider,
  GraphScene,
  GraphSearch,
  MemoriesClientProvider,
  MemoriesNamespacesProvider,
  useMemoriesNamespaces,
} from "@khoralabs/memories-react-graph";

const client = createServiceReactMemoriesClient({
  baseUrl: "https://memories.example",
  database: { kind: "account", ownerKey: "user-1" },
});

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
    <MemoriesClientProvider client={client}>
      <MemoriesNamespacesProvider namespace="global" scope="subtree">
        <GraphProjectionProvider>
          <CreateNamespaceControl />
          <GraphScene />
          <GraphSearch />
        </GraphProjectionProvider>
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
    <GraphInvestigatorProvider client={investigatorClient}>
      <GraphSearch />
      <GraphInvestigatorAnswerOverlay />
    </GraphInvestigatorProvider>
  </MemoriesNamespacesProvider>
</MemoriesClientProvider>
```

For async job + SSE backends, use `createJobStreamInvestigatorClient` with host-specific `startJob`, `streamUrl`, and `parseEvent` hooks.

## Development

```bash
bun run typecheck   # from this package
```

Included in the root `bun run typecheck` workspace script.
