import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { AddNamespaceButton } from "./add-namespace-button.js";
import { SidebarProvider } from "./components/ui/sidebar.js";
import { GraphNamespaceTree } from "./graph-namespace-tree.js";
import { MemoriesClientProvider } from "./memories-client-provider.js";
import { MemoriesNamespacesProvider } from "./memories-namespaces-provider.js";
import { ensureDom } from "./test/ensure-dom.js";
import { createMockReactClient, TEST_DATABASE } from "./test/mock-client.js";

ensureDom();

afterEach(() => {
  cleanup();
});

function Wrapper({ children }: { children: ReactNode }) {
  const client = createMockReactClient();
  return (
    <MemoriesClientProvider createClient={() => client} database={TEST_DATABASE}>
      <MemoriesNamespacesProvider namespaceRoot="acme">
        <SidebarProvider className="min-h-0 w-full">{children}</SidebarProvider>
      </MemoriesNamespacesProvider>
    </MemoriesClientProvider>
  );
}

function CreateNamespaceControl() {
  return (
    <AddNamespaceButton
      type="button"
      title="Create namespace"
      aria-label="Create namespace"
      onClick={() => {}}
    />
  );
}

describe("GraphNamespaceTree.Label", () => {
  test("slots direct AddNamespaceButton into the actions row", () => {
    const { container } = render(
      <Wrapper>
        <GraphNamespaceTree>
          <GraphNamespaceTree.Label>
            Namespaces
            <AddNamespaceButton aria-label="New namespace" />
          </GraphNamespaceTree.Label>
        </GraphNamespaceTree>
      </Wrapper>,
    );
    const label = container.querySelector('[data-slot="sidebar-group-label"]');
    expect(label).not.toBeNull();
    const title = label?.querySelector(".truncate");
    const actions = title?.nextElementSibling;
    expect(title?.textContent).toContain("Namespaces");
    expect(actions?.querySelector('[aria-label="New namespace"]')).not.toBeNull();
    expect(title?.querySelector('[aria-label="New namespace"]')).toBeNull();
  });

  test("LabelActions slots a host wrapper into the actions row", () => {
    const { container } = render(
      <Wrapper>
        <GraphNamespaceTree>
          <GraphNamespaceTree.Label>
            Namespaces
            <GraphNamespaceTree.LabelActions>
              <CreateNamespaceControl />
            </GraphNamespaceTree.LabelActions>
          </GraphNamespaceTree.Label>
        </GraphNamespaceTree>
      </Wrapper>,
    );
    const label = container.querySelector('[data-slot="sidebar-group-label"]');
    expect(label).not.toBeNull();
    const title = label?.querySelector(".truncate");
    const actions = title?.nextElementSibling;
    expect(actions?.querySelector('[aria-label="Create namespace"]')).not.toBeNull();
    expect(title?.querySelector('[aria-label="Create namespace"]')).toBeNull();
  });
});
