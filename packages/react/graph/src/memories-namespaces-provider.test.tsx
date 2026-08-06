import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { useEffect } from "react";

import { MemoriesClientProvider } from "./memories-client-provider.js";
import {
  MemoriesNamespacesProvider,
  useMemoriesNamespaces,
} from "./memories-namespaces-provider.js";
import { ensureDom } from "./test/ensure-dom.js";
import { createMockReactClient, TEST_DATABASE } from "./test/mock-client.js";
import { useGraphNamespacesSearch } from "./use-graph-search.js";

ensureDom();

afterEach(() => {
  cleanup();
});

function Probe(props: { onValue: (v: ReturnType<typeof useMemoriesNamespaces>) => void }) {
  const value = useMemoriesNamespaces();
  useEffect(() => {
    props.onValue(value);
  }, [props, value]);
  return null;
}

function SearchProbe(props: { onValue: (v: ReturnType<typeof useGraphNamespacesSearch>) => void }) {
  const value = useGraphNamespacesSearch();
  useEffect(() => {
    props.onValue(value);
  }, [props, value]);
  return null;
}

describe("MemoriesNamespacesProvider", () => {
  test("catalog namespaceRoot wins; omitted namespace focuses root with subtree", async () => {
    const client = createMockReactClient({
      listNamespaces: mock(async () => ({
        namespaces: [{ namespace: "acme", alias: null, description: "" }],
        namespaceRoot: "acme",
      })),
    });
    let latest: ReturnType<typeof useMemoriesNamespaces> | null = null;

    render(
      <MemoriesClientProvider client={client} database={TEST_DATABASE}>
        <MemoriesNamespacesProvider>
          <Probe
            onValue={(v) => {
              latest = v;
            }}
          />
        </MemoriesNamespacesProvider>
      </MemoriesClientProvider>,
    );

    await waitFor(() => {
      expect(latest?.namespaceRoot).toBe("acme");
      expect(latest?.namespace).toBe("acme");
      expect(latest?.scope).toBe("subtree");
    });
  });

  test("provider namespaceRoot seeds when catalog omits root", async () => {
    const client = createMockReactClient({
      listNamespaces: mock(async () => ({
        namespaces: [{ namespace: "host-root", alias: null, description: "" }],
      })),
    });
    let latest: ReturnType<typeof useMemoriesNamespaces> | null = null;

    render(
      <MemoriesClientProvider client={client} database={TEST_DATABASE}>
        <MemoriesNamespacesProvider namespaceRoot="host-root">
          <Probe
            onValue={(v) => {
              latest = v;
            }}
          />
        </MemoriesNamespacesProvider>
      </MemoriesClientProvider>,
    );

    await waitFor(() => {
      expect(latest?.namespaceRoot).toBe("host-root");
      expect(latest?.namespace).toBe("host-root");
    });
  });

  test("focus on non-root defaults to exact scope", async () => {
    const client = createMockReactClient();
    let latest: ReturnType<typeof useMemoriesNamespaces> | null = null;

    render(
      <MemoriesClientProvider client={client} database={TEST_DATABASE}>
        <MemoriesNamespacesProvider namespaceRoot="acme" namespace="acme/child">
          <Probe
            onValue={(v) => {
              latest = v;
            }}
          />
        </MemoriesNamespacesProvider>
      </MemoriesClientProvider>,
    );

    await waitFor(() => {
      expect(latest?.namespace).toBe("acme/child");
      expect(latest?.scope).toBe("exact");
    });
  });

  test("useGraphNamespacesSearch reflects debounced search results", async () => {
    const searchNamespaces = mock(async () => ({
      query: "team",
      under: null,
      namespaces: [
        {
          namespace: "acme/team",
          lineage: ["acme", "team"],
          score: 1,
          hitCount: 2,
          scoreSum: 2,
          scoreMax: 1,
          topHits: [],
        },
      ],
    }));
    const client = createMockReactClient({ searchNamespaces });
    let latest: ReturnType<typeof useGraphNamespacesSearch> | null = null;

    render(
      <MemoriesClientProvider client={client} database={TEST_DATABASE}>
        <MemoriesNamespacesProvider namespaceRoot="acme" searchDebounceMs={0}>
          <SearchProbe
            onValue={(v) => {
              latest = v;
            }}
          />
        </MemoriesNamespacesProvider>
      </MemoriesClientProvider>,
    );

    await waitFor(() => expect(latest).not.toBeNull());
    await act(async () => {
      latest?.setSearchQuery("team");
    });

    await waitFor(() => {
      expect(searchNamespaces).toHaveBeenCalled();
      expect(latest?.searchResults?.map((r) => r.namespace)).toEqual(["acme/team"]);
      expect(latest?.summary).toBe("1 namespace");
    });
  });
});
