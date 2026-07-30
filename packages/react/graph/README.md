# @khoralabs/memories-react-graph

React components for exploring a memories knowledge graph in 3D: hybrid search, namespace selection, memory preview, and an optional investigator Q&A overlay.

Built on **React 19**, **@react-three/fiber**, and **three.js**. The package does **not** open a database — the host injects layout and search. Layout types and builders come from `@khoralabs/memories-node/projections` (or a backend-specific helper such as `@khoralabs/memories-node/sqlite` / `./libsql`).

## Exports

| Export | Role |
|--------|------|
| `GraphScene` | 3D graph canvas with nodes, edges, focus/hover |
| `GraphProjectionProvider` / `useProjection` | Projection + chrome context from host |
| `GraphSearch` | Search input with hybrid query + optional deep-search toggle |
| `GraphNamespaceSelector` | Namespace picker |
| `GraphInvestigatorProvider` / `GraphInvestigatorAnswer` | Investigator Q&A overlay (requires a `GraphInvestigatorClient`) |
| `createSyncInvestigatorClient` / `createJobStreamInvestigatorClient` | Sync POST or job+SSE investigator transports |
| `GraphPreviewDock` | Selected memory preview panel |
| `GraphLoading`, `GraphFetchError` | Loading and error states |

Peer dependencies: `react`, `react-dom`, `three`, `@react-three/fiber`, `@react-three/drei`, `@react-three/postprocessing` (used when `fog.blur` is enabled for screen-space edge softening).

## Host integration

1. Build a `NamespaceGraphLayout` via `@khoralabs/memories-node/projections` (or sqlite/libsql projection helpers).
2. Expose search and layout through HTTP or in-process handlers.
3. Wrap the scene in `GraphProjectionProvider` with fetch callbacks and namespace state.

```tsx
import { GraphProjectionProvider, GraphScene, GraphSearch } from "@khoralabs/memories-react-graph";

function MemoriesGraphPage() {
  return (
    <GraphProjectionProvider
      namespace={namespace}
      onSearch={runHybridSearch}
      layout={graphLayout}
    >
      <GraphScene />
      <GraphSearch />
    </GraphProjectionProvider>
  );
}
```

See `src/graph-search.tsx`, `src/scene.tsx`, and `src/use-projection.tsx` for prop shapes.

### Investigator client

`GraphInvestigatorProvider` is transport-agnostic: pass a `GraphInvestigatorClient` that starts an investigation and reports progress, completion, or errors via callbacks.

```tsx
import {
  GraphInvestigatorProvider,
  createSyncInvestigatorClient,
} from "@khoralabs/memories-react-graph";

const client = createSyncInvestigatorClient({
  investigateUrl: "/api/memories/investigate",
});

<GraphInvestigatorProvider client={client}>
  <GraphSearch />
  <GraphInvestigatorAnswerOverlay />
</GraphInvestigatorProvider>
```

For async job + SSE backends, use `createJobStreamInvestigatorClient` with host-specific `startJob`, `streamUrl`, and `parseEvent` hooks.

## Development

```bash
bun run typecheck   # from this package
```

Included in the root `bun run typecheck` workspace script.
