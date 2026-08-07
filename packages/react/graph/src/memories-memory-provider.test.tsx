import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { type ReactNode, useEffect } from "react";

import { MemoriesClientProvider } from "./memories-client-provider.js";
import {
  MemoriesNamespaceMemoriesProvider,
  useMemoriesMemory,
} from "./memories-memory-provider.js";
import { MemoriesNamespacesProvider } from "./memories-namespaces-provider.js";
import type { GraphSearchState } from "./projection-types.js";
import { ensureDom } from "./test/ensure-dom.js";
import { createMockReactClient, emptyGraph, TEST_DATABASE } from "./test/mock-client.js";
import { useGraphMemoriesSearch } from "./use-graph-search.js";

ensureDom();

afterEach(() => {
  cleanup();
});

function MemoryProbe(props: { onValue: (v: ReturnType<typeof useMemoriesMemory>) => void }) {
  const value = useMemoriesMemory();
  useEffect(() => {
    props.onValue(value);
  }, [props, value]);
  return null;
}

function SearchProbe(props: { onValue: (v: ReturnType<typeof useGraphMemoriesSearch>) => void }) {
  const value = useGraphMemoriesSearch();
  useEffect(() => {
    props.onValue(value);
  }, [props, value]);
  return null;
}

function mount(client: ReturnType<typeof createMockReactClient>, child: ReactNode) {
  return render(
    <MemoriesClientProvider client={client} database={TEST_DATABASE}>
      <MemoriesNamespacesProvider namespaceRoot="acme" namespace="acme" scope="subtree">
        <MemoriesNamespaceMemoriesProvider searchDebounceMs={0}>
          {child}
        </MemoriesNamespaceMemoriesProvider>
      </MemoriesNamespacesProvider>
    </MemoriesClientProvider>,
  );
}

describe("MemoriesNamespaceMemoriesProvider", () => {
  test("loads graph for focused namespace", async () => {
    const getGraph = mock(async (input: { namespace: string }) => ({
      ...emptyGraph(input.namespace),
      nodes: [
        {
          key: "n1",
          x: 0,
          y: 0,
          z: 0,
          labels: [],
          degree: { count: 0, centrality: 0 },
        },
      ],
    }));
    const client = createMockReactClient({ getGraph });
    let latest: ReturnType<typeof useMemoriesMemory> | null = null;

    mount(
      client,
      <MemoryProbe
        onValue={(v) => {
          latest = v;
        }}
      />,
    );

    await waitFor(() => {
      expect(getGraph).toHaveBeenCalled();
      expect(latest?.payload.nodes.map((n) => n.key)).toEqual(["n1"]);
      expect(latest?.loading).toBe(false);
    });
  });

  test("effectiveGraphSearch prefers override; useGraphMemoriesSearch summary uses it", async () => {
    const client = createMockReactClient();
    let latest: ReturnType<typeof useGraphMemoriesSearch> | null = null;

    mount(
      client,
      <SearchProbe
        onValue={(v) => {
          latest = v;
        }}
      />,
    );

    await waitFor(() => expect(latest).not.toBeNull());

    const override: GraphSearchState = {
      hitCount: 3,
      relevantKeys: new Set(["a", "b"]),
      hitSnippetByKey: new Map(),
      hitSnippetByEdgeId: new Map(),
    };
    await act(async () => {
      latest?.setSearchQuery("ignored-for-override");
      latest?.setGraphSearchOverride(override);
    });

    await waitFor(() => {
      expect(latest?.effectiveGraphSearch).toEqual(override);
      expect(latest?.summary).toBe("3 hits · 2 in subgraph");
    });
  });

  test("debounced search calls client.search and fills graphSearch", async () => {
    const search = mock(async () => ({
      hitCount: 1,
      hitKeys: ["acme::n1"],
      neighborKeys: [],
      keys: ["acme::n1"],
      hitSnippets: [{ key: "acme::n1", text: "hello" }],
      edgeHitSnippets: [],
    }));
    const client = createMockReactClient({ search });
    let latest: ReturnType<typeof useGraphMemoriesSearch> | null = null;

    mount(
      client,
      <SearchProbe
        onValue={(v) => {
          latest = v;
        }}
      />,
    );

    await waitFor(() => expect(latest).not.toBeNull());
    await act(async () => {
      latest?.setSearchQuery("hello");
    });

    await waitFor(() => {
      expect(search).toHaveBeenCalled();
      expect(latest?.graphSearch?.hitCount).toBe(1);
      expect(latest?.graphSearch?.relevantKeys.has("acme::n1")).toBe(true);
      expect(latest?.summary).toContain("1 hit");
    });
  });
});
