# @khoralabs/memories-react-graph

React components for exploring a memories knowledge graph in 3D: hybrid search, namespace selection, memory preview, and an optional investigator Q&A overlay.

Built on **React 19**, **@react-three/fiber**, and **three.js**. The package does **not** open a database — the host injects a `ReactMemoriesClient` (HTTP or custom) via `MemoriesClientProvider`.

## Exports

| Export | Role |
|--------|------|
| `MemoriesClientProvider` / `useMemoriesClient` | Injected graph backend client |
| `createHttpReactMemoriesClient` / `ReactMemoriesClient` | Default HTTP client + interface |
| `GraphScene` | 3D graph canvas with nodes, edges, focus/hover |
| `GraphProjectionProvider` / `useProjection` | Projection + chrome context (requires client provider) |
| `GraphSearch` | Search input with hybrid query + optional deep-search toggle |
| `GraphNamespaceSelector` | Namespace picker |
| `GraphInvestigatorProvider` / `GraphInvestigatorAnswer` | Investigator Q&A overlay (requires a `GraphInvestigatorClient`) |
| `createSyncInvestigatorClient` / `createJobStreamInvestigatorClient` | Sync POST or job+SSE investigator transports |
| `GraphPreviewDock` | Selected memory preview panel |
| `GraphLoading`, `GraphFetchError` | Loading and error states |

Peer dependencies: `react`, `react-dom`, `three`, `@react-three/fiber`, `@react-three/drei`, `@react-three/postprocessing` (used when `fog.blur` is enabled for screen-space edge softening).

## Host integration

1. Expose host REST routes under a base URL (or implement `ReactMemoriesClient` yourself):
   - `GET /namespaces`
   - `GET /graph?namespace=…[&scope=subtree]`
   - `POST /search`
   - `GET /edge-preview?namespace=…&edgeId=…`
   - `POST /investigate` (optional)
2. Mount `MemoriesClientProvider` above `GraphProjectionProvider`.

```tsx
import {
  createHttpReactMemoriesClient,
  GraphProjectionProvider,
  GraphScene,
  GraphSearch,
  MemoriesClientProvider,
} from "@khoralabs/memories-react-graph";

const client = createHttpReactMemoriesClient({ baseUrl: "/api/memories" });

function MemoriesGraphPage() {
  return (
    <MemoriesClientProvider client={client}>
      <GraphProjectionProvider namespace="global" scope="subtree">
        <GraphScene />
        <GraphSearch />
      </GraphProjectionProvider>
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
  createHttpReactMemoriesClient,
} from "@khoralabs/memories-react-graph";

const memoriesClient = createHttpReactMemoriesClient({ baseUrl: "/api/memories" });
const investigatorClient = createSyncInvestigatorClient({ client: memoriesClient });

<MemoriesClientProvider client={memoriesClient}>
  <GraphInvestigatorProvider client={investigatorClient}>
    <GraphSearch />
    <GraphInvestigatorAnswerOverlay />
  </GraphInvestigatorProvider>
</MemoriesClientProvider>
```

For async job + SSE backends, use `createJobStreamInvestigatorClient` with host-specific `startJob`, `streamUrl`, and `parseEvent` hooks.

## Development

```bash
bun run typecheck   # from this package
```

Included in the root `bun run typecheck` workspace script.
