# @khoralabs/memories-react-graph

React components for exploring a memories knowledge graph in 3D: hybrid search, namespace selection, and memory preview.

Built on **React 19**, **@react-three/fiber**, and **three.js**. The package does **not** open a database by itself — mount `MemoriesClientProvider` with a `ReactMemoriesClient` (or `createClient` factory for database switching), then namespaces + memory providers for catalog/focus/CRUD.

## Exports

| Export | Role |
|--------|------|
| `MemoriesClientProvider` / `useMemoriesClient` / `useMemoriesDatabase` | Client + database focus + resolved ontology |
| `MemoriesNamespacesProvider` / `useMemoriesNamespaces` | Namespace catalog, focus, CRUD/suppress, arms-driven search |
| `MemoriesMemoryProvider` / `useMemoriesMemory` | Scope-sensitive graph catalog, search, memory focus, create/update/remove |
| `useGraphMemoriesSearch` / `useGraphNamespacesSearch` | Thin chrome slices of provider search state |
| `createServiceReactMemoriesClient` / `ReactMemoriesClient` | Service HTTP client + interface |
| `DEFAULT_SEARCH_DEBOUNCE_MS` | Shared default debounce for namespace + memory search |
| `GraphScene` | 3D graph canvas with nodes, edges, focus/hover |
| `GraphProjectionProvider` / `useProjection` | Scene projection + chrome (reads payload/search/focus from memory provider) |
| `GraphSearch` / `GraphNamespaceSearch` | Memory / namespace search inputs |
| `GraphNamespaceTree` | Hierarchical namespace browser; Hierarchy filters to ranked search hits |
| `AddNamespaceButton` / `AddMemoryButton` / `RefreshGraphButton` | Compound chrome buttons (`.Tooltip` + `Button` props) |
| `GraphPreviewDock` | Selected memory preview panel |
| `GraphLoading`, `GraphFetchError` | Loading and error states |

Peer dependencies: `react`, `react-dom`, `three`, `@react-three/fiber`, `@react-three/drei`, `@react-three/postprocessing` (used when `fog.blur` is enabled for screen-space edge softening).

## Host integration

1. Point at memories-service (`createServiceReactMemoriesClient`) or implement `ReactMemoriesClient`.
2. Mount `MemoriesClientProvider` → `MemoriesNamespacesProvider` → `MemoriesMemoryProvider` → `GraphProjectionProvider`.
3. Hosts own create forms; call `useMemoriesNamespaces().create` / `useMemoriesMemory().create`. Use `AddNamespaceButton` / `AddMemoryButton` as chrome triggers only (wire `onClick`).
4. The memory catalog follows namespaces `scope` (`exact` vs `subtree`). Search uses the same scope via `useMemoriesMemory` / `GraphSearch`.
5. Namespace search (`GraphNamespaceSearch`) is arms-driven; tune with `useGraphNamespacesSearch().setSearchArms` (e.g. `{ nodes: 0, lexical: 1 }` for catalog-only). Pair with `GraphNamespaceTree` — Hierarchy shows the full catalog when the query is empty, and a score-ordered hit tree while searching.

```tsx
import {
  AddMemoryButton,
  AddNamespaceButton,
  createServiceReactMemoriesClient,
  GraphNamespaceSearch,
  GraphNamespaceTree,
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
            <GraphNamespaceSearch />
            <GraphNamespaceTree>
              <GraphNamespaceTree.Label>
                Namespaces
                <AddNamespaceButton />
              </GraphNamespaceTree.Label>
              <GraphNamespaceTree.Hierarchy />
            </GraphNamespaceTree>
            <GraphSearch />
            <GraphScene />
          </GraphProjectionProvider>
        </MemoriesMemoryProvider>
      </MemoriesNamespacesProvider>
    </MemoriesClientProvider>
  );
}
```

Optional `ReactMemoriesClient.investigate` remains for host-built agents; this package does not ship an investigator UI. Hosts can still drive subgraph highlighting via `useGraphMemoriesSearch().setGraphSearchOverride`.

## Development

```bash
bun run typecheck   # from this package
```

Included in the root `bun run typecheck` workspace script.
