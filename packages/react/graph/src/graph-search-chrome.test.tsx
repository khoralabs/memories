import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { ScanSearchIcon } from "lucide-react";
import type { ReactNode } from "react";

import { GraphNamespaceSearch } from "./graph-namespace-search.js";
import { GraphSearch } from "./graph-search.js";
import { MemoriesClientProvider } from "./memories-client-provider.js";
import { MemoriesNamespaceMemoriesProvider } from "./memories-memory-provider.js";
import { MemoriesNamespacesProvider } from "./memories-namespaces-provider.js";
import { ensureDom } from "./test/ensure-dom.js";
import { createMockReactClient, TEST_DATABASE } from "./test/mock-client.js";

ensureDom();

afterEach(() => {
  cleanup();
});

function wrap(child: ReactNode) {
  const client = createMockReactClient();
  return (
    <MemoriesClientProvider client={client} database={TEST_DATABASE}>
      <MemoriesNamespacesProvider namespaceRoot="acme" searchDebounceMs={0}>
        <MemoriesNamespaceMemoriesProvider searchDebounceMs={0}>
          {child}
        </MemoriesNamespaceMemoriesProvider>
      </MemoriesNamespacesProvider>
    </MemoriesClientProvider>
  );
}

describe("search chrome", () => {
  test("GraphSearch updates memory search query", async () => {
    const view = render(wrap(<GraphSearch />));
    const input = await view.findByLabelText("Search memories");
    fireEvent.change(input, { target: { value: "hello" } });
    await waitFor(() => {
      expect((input as HTMLInputElement).value).toBe("hello");
    });
  });

  test("GraphNamespaceSearch updates namespace search query", async () => {
    const view = render(wrap(<GraphNamespaceSearch />));
    const input = await view.findByLabelText("Search namespaces");
    fireEvent.change(input, { target: { value: "team" } });
    await waitFor(() => {
      expect((input as HTMLInputElement).value).toBe("team");
    });
  });

  test("GraphSearch compound Input / Addon / Loading wires query and status", async () => {
    const view = render(
      wrap(
        <GraphSearch>
          <GraphSearch.Input />
          <GraphSearch.Addon>
            <ScanSearchIcon aria-hidden data-testid="custom-icon" />
          </GraphSearch.Addon>
          <GraphSearch.Addon align="inline-end" data-testid="status-addon">
            <GraphSearch.Loading />
          </GraphSearch.Addon>
        </GraphSearch>,
      ),
    );
    expect(view.getByTestId("custom-icon")).toBeTruthy();
    const input = await view.findByLabelText("Search memories");
    fireEvent.change(input, { target: { value: "alpha" } });
    await waitFor(() => {
      expect((input as HTMLInputElement).value).toBe("alpha");
    });
    // After debounce, summary or ellipsis appears in the status addon.
    await waitFor(() => {
      const status = view.getByTestId("status-addon");
      expect(status.textContent?.length ?? 0).toBeGreaterThan(0);
    });
  });

  test("GraphNamespaceSearch compound Loading lives in host Addon", async () => {
    const view = render(
      wrap(
        <GraphNamespaceSearch>
          <GraphNamespaceSearch.Input placeholder="Find ns…" />
          <GraphNamespaceSearch.Addon align="inline-end" data-testid="ns-status">
            <GraphNamespaceSearch.Loading />
          </GraphNamespaceSearch.Addon>
        </GraphNamespaceSearch>,
      ),
    );
    const input = await view.findByLabelText("Search namespaces");
    expect((input as HTMLInputElement).placeholder).toBe("Find ns…");
    fireEvent.change(input, { target: { value: "ops" } });
    await waitFor(() => {
      expect((input as HTMLInputElement).value).toBe("ops");
    });
    expect(view.getByTestId("ns-status")).toBeTruthy();
  });
});
