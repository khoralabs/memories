import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, render, waitFor } from "@testing-library/react";

import type { EdgePreviewJson, MemoryPreviewJson } from "./memories-client.js";
import { MemoryEdgeHoverCard, MemoryNodeHoverCard } from "./memory-relation-hovers.js";
import { ensureDom } from "./test/ensure-dom.js";
import { createMockReactClient } from "./test/mock-client.js";

ensureDom();

afterEach(() => {
  cleanup();
});

function previewForKey(key: string, namespace = "ns"): MemoryPreviewJson {
  const text = `excerpt-${key}`;
  return {
    key,
    namespace,
    labels: [],
    content: [
      {
        sourceKey: "body",
        sourceMapId: `sm_${key}`,
        text,
        hasText: true,
        hasVector: false,
        createdAt: 1,
      },
    ],
    properties: null,
    suppressed: false,
  };
}

function edgePreviewForId(edgeId: string): EdgePreviewJson {
  return {
    edgeId,
    fromKey: `from-${edgeId}`,
    toKey: `to-${edgeId}`,
    labels: [],
    properties: null,
  };
}

describe("MemoryNodeHoverCard identity reset", () => {
  test("resets fetched flag so identity change without prefetch refetches", async () => {
    const getMemoryPreview = mock(async (input: { namespace: string; key: string }) =>
      previewForKey(input.key, input.namespace),
    );
    const client = createMockReactClient({ getMemoryPreview });

    const { rerender } = render(
      <MemoryNodeHoverCard
        client={client}
        namespace="ns"
        memoryKey="k1"
        prefetchedContent={[{ sourceKey: "body", text: "excerpt-k1" }]}
        open
        onOpenChange={() => {}}
      >
        trigger
      </MemoryNodeHoverCard>,
    );

    // Prefetch path: no network while open.
    await act(async () => {});
    expect(getMemoryPreview).not.toHaveBeenCalled();

    await act(async () => {
      rerender(
        <MemoryNodeHoverCard
          client={client}
          namespace="ns"
          memoryKey="k2"
          open
          onOpenChange={() => {}}
        >
          trigger
        </MemoryNodeHoverCard>,
      );
    });

    await waitFor(() => {
      expect(getMemoryPreview.mock.calls.some((c) => c[0]?.key === "k2")).toBe(true);
    });
  });

  test("refetches when memoryKey changes while open", async () => {
    const getMemoryPreview = mock(async (input: { namespace: string; key: string }) =>
      previewForKey(input.key, input.namespace),
    );
    const client = createMockReactClient({ getMemoryPreview });

    const { rerender } = render(
      <MemoryNodeHoverCard
        client={client}
        namespace="ns"
        memoryKey="k1"
        open
        onOpenChange={() => {}}
      >
        trigger
      </MemoryNodeHoverCard>,
    );

    await waitFor(() => {
      expect(getMemoryPreview.mock.calls.some((c) => c[0]?.key === "k1")).toBe(true);
    });

    await act(async () => {
      rerender(
        <MemoryNodeHoverCard
          client={client}
          namespace="ns"
          memoryKey="k2"
          open
          onOpenChange={() => {}}
        >
          trigger
        </MemoryNodeHoverCard>,
      );
    });

    await waitFor(() => {
      expect(getMemoryPreview.mock.calls.some((c) => c[0]?.key === "k2")).toBe(true);
    });
  });
});

describe("MemoryEdgeHoverCard identity reset", () => {
  test("refetches when edgeId changes while open", async () => {
    const getEdgePreview = mock(async (input: { namespace: string; edgeId: string }) =>
      edgePreviewForId(input.edgeId),
    );
    const client = createMockReactClient({ getEdgePreview });

    const { rerender } = render(
      <MemoryEdgeHoverCard
        client={client}
        namespace="ns"
        edgeId="e1"
        href="/e1"
        open
        onOpenChange={() => {}}
      >
        trigger
      </MemoryEdgeHoverCard>,
    );

    await waitFor(() => {
      expect(getEdgePreview.mock.calls.some((c) => c[0]?.edgeId === "e1")).toBe(true);
    });

    await act(async () => {
      rerender(
        <MemoryEdgeHoverCard
          client={client}
          namespace="ns"
          edgeId="e2"
          href="/e2"
          open
          onOpenChange={() => {}}
        >
          trigger
        </MemoryEdgeHoverCard>,
      );
    });

    await waitFor(() => {
      expect(getEdgePreview.mock.calls.some((c) => c[0]?.edgeId === "e2")).toBe(true);
    });
  });
});
