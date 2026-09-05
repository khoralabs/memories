import {
  GraphNamespaceSearch,
  GraphNamespaceTree,
  GraphProjectionProvider,
  GraphScene,
  GraphSearch,
  MemoriesClientProvider,
  MemoriesNamespaceMemoriesProvider,
  MemoriesNamespacesProvider,
} from "@/components/memories";
import type { MemoriesDatabaseId } from "@/components/memories/memories-client";
import { createDemoMemoriesClient, DEMO_DATABASE } from "./demo-client";
import "./index.css";

const createClient = (_database: MemoriesDatabaseId) => createDemoMemoriesClient();

export function App() {
  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="border-b border-border px-4 py-3">
        <h1 className="text-lg font-medium">Memories graph (registry)</h1>
        <p className="text-sm text-muted-foreground">
          Installed from khoralabs/react/memories — mock client, no npm memories-react-graph.
        </p>
      </header>
      <MemoriesClientProvider createClient={createClient} database={DEMO_DATABASE}>
        <MemoriesNamespacesProvider namespaceRoot="demo">
          <MemoriesNamespaceMemoriesProvider>
            <GraphProjectionProvider>
              <div className="grid min-h-0 flex-1 grid-cols-[16rem_1fr] gap-0">
                <aside className="flex min-h-0 flex-col gap-3 border-r border-border p-3">
                  <GraphNamespaceSearch />
                  <GraphNamespaceTree>
                    <GraphNamespaceTree.Label>Namespaces</GraphNamespaceTree.Label>
                    <GraphNamespaceTree.Hierarchy />
                  </GraphNamespaceTree>
                  <GraphSearch />
                </aside>
                <main className="min-h-0">
                  <GraphScene className="h-full w-full" />
                </main>
              </div>
            </GraphProjectionProvider>
          </MemoriesNamespaceMemoriesProvider>
        </MemoriesNamespacesProvider>
      </MemoriesClientProvider>
    </div>
  );
}
