# @khoralabs/memories-react-graph

React components for exploring a memories knowledge graph in 3D: hybrid search, namespace selection, and memory preview.

Built on **React 19**, **@react-three/fiber**, and **three.js**. The package does **not** open a database by itself — mount `MemoriesClientProvider` with a `ReactMemoriesClient` (or `createClient` factory for database switching), then namespaces + namespace-memories providers for catalog/focus/CRUD.

## Exports

| Export | Role |
|--------|------|
| `@khoralabs/memories-react-graph` | Browser UI: providers, graph chrome, hooks, `ReactMemoriesClient` **type** |
| `@khoralabs/memories-react-graph/service` | `createServiceReactMemoriesClient` (Node/server or hosts that intentionally pull memories-service) |
| `MemoriesClientProvider` / `useMemoriesClient` / `useMemoriesDatabase` | Client + database focus + resolved ontology |
| `MemoriesNamespacesProvider` / `useMemoriesNamespaces` | Namespace catalog, focus, CRUD/suppress, arms-driven search |
| `MemoriesNamespaceMemoriesProvider` / `useMemoriesMemory` | Scope-sensitive graph catalog, search, memory focus, create/update/remove (`MemoriesMemoryProvider` is a deprecated alias) |
| `useGraphMemoriesSearch` / `useGraphNamespacesSearch` | Thin chrome slices of provider search state (not `useMemoriesGraphChrome`) |
| `ReactMemoriesClient` | Host backend interface (implement over a BFF, or use `/service`) |
| `DEFAULT_SEARCH_DEBOUNCE_MS` | Shared default debounce for namespace + memory search |
| `GraphScene` | 3D graph canvas with nodes, edges, focus/hover |
| `GraphProjectionProvider` / `useProjection` / `useMemoriesGraphChrome` | Scene projection; chrome = load/refresh/Esc (search is via search hooks) |
| `GraphSearch` / `GraphNamespaceSearch` | Memory / namespace search (`Input` / `Addon` / `Loading` compounds; bare `<GraphSearch />` keeps defaults) |
| `GraphNamespaceTree` | Hierarchical namespace browser; Hierarchy filters to ranked search hits |
| `AddNamespaceButton` / `AddMemoryButton` / `RefreshGraphButton` | Compound chrome buttons (`.Tooltip` + `Button` props) |
| `GraphPreviewDock` | Selected memory preview panel (`children` fully replaces default billboard) |
| `NodeBillboard` / `EdgeBillboard` | Compound preview cards (`Header` / `Loading` / `Labels` / `Metadata`) |
| `GraphLoading`, `GraphFetchError` | Loading and error states |

Peer dependencies: `react`, `react-dom`, `three`, `@react-three/fiber`, `@react-three/drei`, `@react-three/postprocessing` (used when `fog.blur` is enabled for screen-space edge softening). Optional peer: `@khoralabs/memories-service` (only for `/service`).

## Host integration

1. Implement `ReactMemoriesClient` (browser BFF) **or** import `createServiceReactMemoriesClient` from `@khoralabs/memories-react-graph/service` (do **not** import `/service` into a Vite/Bun HTML client bundle that only needs UI).
2. Mount `MemoriesClientProvider` → `MemoriesNamespacesProvider` → `MemoriesNamespaceMemoriesProvider` → `GraphProjectionProvider`.
3. **Namespace root is host-owned** (no package default). Prefer `listNamespaces.namespaceRoot` (catalog wins); else provider `namespaceRoot` prop. With `createServiceReactMemoriesClient`, pass `namespaceRoot` on the client (stamped onto `listNamespaces`) and/or on the provider — bare service catalog has no root field. Omitting focus `namespace` lands on that root with `subtree` once known.
4. Hosts own create forms; call `useMemoriesNamespaces().create` / `useMemoriesMemory().create`. Use `AddNamespaceButton` / `AddMemoryButton` as chrome triggers only (wire `onClick`).
5. The memory catalog follows namespaces `scope` (`exact` vs `subtree`). Memory search UI uses `useGraphMemoriesSearch` / `GraphSearch` (not `useMemoriesGraphChrome`). Bare `<GraphSearch />` / `<GraphNamespaceSearch />` keep the default input + icon + status chrome; compose `.Input` / `.Addon` / `.Loading` to add or reorder addons.
6. Namespace search (`GraphNamespaceSearch`) is arms-driven; tune with `useGraphNamespacesSearch().setSearchArms` (e.g. `{ nodes: 0, lexical: 1 }` for catalog-only). Pair with `GraphNamespaceTree` — Hierarchy shows the full catalog when the query is empty, and a score-ordered hit tree while searching.

```tsx
import {
  AddMemoryButton,
  AddNamespaceButton,
  GraphNamespaceSearch,
  GraphNamespaceTree,
  GraphProjectionProvider,
  GraphScene,
  GraphSearch,
  MemoriesClientProvider,
  MemoriesNamespaceMemoriesProvider,
  MemoriesNamespacesProvider,
  useMemoriesMemory,
  useMemoriesNamespaces,
} from "@khoralabs/memories-react-graph";
import { createServiceReactMemoriesClient } from "@khoralabs/memories-react-graph/service";

const database = { kind: "account" as const, ownerKey: "user-1" };
const createClient = (db: typeof database) =>
  createServiceReactMemoriesClient({
    baseUrl: "https://memories.example",
    database: db,
    namespaceRoot: "global", // host convention
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
      <MemoriesNamespacesProvider>
        <MemoriesNamespaceMemoriesProvider>
          <GraphProjectionProvider>
            <CreateNamespaceControl />
            <CreateMemoryControl />
            <GraphNamespaceSearch />
            <GraphNamespaceTree>
              <GraphNamespaceTree.Label>
                Namespaces
                {/* Wrappers must use LabelActions (direct AddNamespaceButton also works) */}
                <GraphNamespaceTree.LabelActions>
                  <CreateNamespaceControl />
                </GraphNamespaceTree.LabelActions>
              </GraphNamespaceTree.Label>
              <GraphNamespaceTree.Hierarchy />
            </GraphNamespaceTree>
            <GraphSearch />
            <GraphScene />
          </GraphProjectionProvider>
        </MemoriesNamespaceMemoriesProvider>
      </MemoriesNamespacesProvider>
    </MemoriesClientProvider>
  );
}
```

Hosts can still drive subgraph highlighting via `useGraphMemoriesSearch().setGraphSearchOverride` (e.g. after calling `@khoralabs/memories-agents` or a host investigate route).

Compose search chrome when you need extra addons (`.Loading` is the status spinner / summary):

```tsx
<GraphSearch>
  <GraphSearch.Input />
  <GraphSearch.Addon>…</GraphSearch.Addon>
  <GraphSearch.Addon align="inline-end">
    <GraphSearch.Loading />
  </GraphSearch.Addon>
</GraphSearch>
```

## Preview / billboards

`GraphPreviewDock` mounts the default `NodeBillboard` / `EdgeBillboard` for the active preview target. Passing **`children` fully replaces** that default (no built-in billboard is composed underneath).

Billboards are compounds:

- **`Labels`** — ontology label **kinds** by default (not JSON of label `props`). Use a render prop `((ctx) => …)` for custom rows; `ctx.labels` still includes ontology `props`.
- **`Metadata`** — freeform memory/edge **`properties`** (`nodes.properties` / edge JSON blob). Empty when none.
- **`Loading`** — shown while preview fetch is in flight.
- Ontology label **`props` ≠ freeform `properties`**: the former are typed schema fields on a label kind; the latter are the unstructured property bag on the node/edge row. Do not stringify label props into Labels.

```tsx
<GraphPreviewDock>
  {(content) =>
    content.kind === "node" ? (
      <NodeBillboard point={content.point} open>
        <NodeBillboard.Header />
        <NodeBillboard.Labels>
          {(ctx) =>
            ctx.labels.map((lb) => (
              <li key={lb.kind}>{lb.kind}</li>
            ))
          }
        </NodeBillboard.Labels>
        <NodeBillboard.Metadata />
      </NodeBillboard>
    ) : (
      <EdgeBillboard edge={content.edge} open />
    )
  }
</GraphPreviewDock>
```

`useNodeBillboard()` / `useEdgeBillboard()` expose `properties`, `loading`, and preview `detail` so hosts need not re-fetch `getMemoryPreview` / `getEdgePreview` for the dock.

## Development

```bash
bun install
bun test packages/react/graph
bun run --filter @khoralabs/memories-react-graph typecheck
```
