import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import { GraphNamespaceSearch } from "./graph-namespace-search.js";
import { GraphSearch } from "./graph-search.js";
import { MemoriesClientProvider } from "./memories-client-provider.js";
import { MemoriesMemoryProvider } from "./memories-memory-provider.js";
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
        <MemoriesMemoryProvider searchDebounceMs={0}>{child}</MemoriesMemoryProvider>
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
});
