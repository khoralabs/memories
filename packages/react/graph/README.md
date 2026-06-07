# @khoralabs/memories-react-graph

React components for exploring a memories knowledge graph in 3D: hybrid search, namespace selection, memory preview, and an optional investigator Q&A overlay.

Built on **React 19**, **@react-three/fiber**, and **three.js**. Expects graph layout and search state from a host-provided projection API (typically backed by `@khoralabs/memories-sqlite` layout helpers).

## Exports

| Export | Role |
|--------|------|
| `GraphScene` | 3D graph canvas with nodes, edges, focus/hover |
| `GraphProjectionProvider` / `useProjection` | Projection + chrome context from host |
| `GraphSearch` | Search input with hybrid query + optional deep-search toggle |
| `GraphNamespaceSelector` | Namespace picker |
| `GraphInvestigatorProvider` / `GraphInvestigatorAnswer` | Investigator Q&A overlay |
| `GraphPreviewDock` | Selected memory preview panel |
| `GraphLoading`, `GraphFetchError` | Loading and error states |
| `buildNamespaceGraphLayout` consumers | Use layout types from `@khoralabs/memories-sqlite` in the host |

Peer dependencies: `react`, `react-dom`, `three`, `@react-three/fiber`, `@react-three/drei`.

## Host integration

The graph UI does not open a database itself. The host:

1. Opens a readonly SQLite DB and builds a `NamespaceGraphLayout` via `@khoralabs/memories-sqlite`.
2. Exposes search and layout through HTTP or in-process handlers.
3. Wraps the scene in `GraphProjectionProvider` with fetch callbacks and namespace state.

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

## Development

```bash
bun run typecheck   # from this package
```

Typecheck is included in the root `bun run typecheck` workspace script.
