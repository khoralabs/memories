import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import { EdgeBillboard } from "./edge-billboard.js";
import { GraphNodeBillboardOntology } from "./graph-billboard-compounds.js";
import { MemoriesClientProvider } from "./memories-client-provider.js";
import { MemoriesNamespaceMemoriesProvider } from "./memories-memory-provider.js";
import { MemoriesNamespacesProvider } from "./memories-namespaces-provider.js";
import { NodeBillboard } from "./node-billboard.js";
import type { ProjectionPoint, SceneEdge } from "./projection-types.js";
import { ensureDom } from "./test/ensure-dom.js";
import { createMockReactClient, TEST_DATABASE } from "./test/mock-client.js";
import { GraphProjectionProvider } from "./use-projection.js";

ensureDom();

afterEach(() => {
  cleanup();
});

const point: ProjectionPoint = {
  entryId: "n1",
  key: "n1",
  x: 0,
  y: 0,
  z: 0,
  labels: [{ kind: "Person", props: { name: "Ada" } }],
  degree: { count: 0, centrality: 0 },
};

const edge: SceneEdge = {
  key: "a|b",
  edgeId: "e1",
  fromKey: "a",
  toKey: "b",
  labels: [{ kind: "knows", props: { since: 2020 } }],
};

function mount(client: ReturnType<typeof createMockReactClient>, child: ReactNode) {
  return render(
    <MemoriesClientProvider createClient={() => client} database={TEST_DATABASE}>
      <MemoriesNamespacesProvider namespaceRoot="acme">
        <MemoriesNamespaceMemoriesProvider>
          <GraphProjectionProvider>{child}</GraphProjectionProvider>
        </MemoriesNamespaceMemoriesProvider>
      </MemoriesNamespacesProvider>
    </MemoriesClientProvider>,
  );
}

describe("NodeBillboard", () => {
  test("Labels kinds-only; Metadata shows freeform properties from preview", async () => {
    const getMemoryPreview = mock(async () => ({
      key: "n1",
      namespace: "acme",
      labels: [{ kind: "Person", props: { name: "Ada" } }],
      content: [],
      properties: { title: "Note" },
      suppressed: false,
    }));
    const client = createMockReactClient({ getMemoryPreview });
    const { container } = mount(client, <NodeBillboard point={point} open />);

    await waitFor(() => {
      expect(container.textContent).toContain("Person");
      expect(container.textContent).toContain("Node metadata");
      expect(container.textContent).toContain("title");
      expect(container.textContent).toContain("Note");
    });
    expect(container.textContent).not.toContain("Ada");
    expect(getMemoryPreview).toHaveBeenCalled();
  });

  test("Labels render prop receives ontology labels with props", async () => {
    const client = createMockReactClient({
      getMemoryPreview: mock(async () => ({
        key: "n1",
        namespace: "acme",
        labels: [],
        content: [],
        properties: null,
        suppressed: false,
      })),
    });
    const { container } = mount(
      client,
      <NodeBillboard point={point} open properties={null}>
        <NodeBillboard.Labels>
          {(ctx) => {
            const name = ctx.labels[0]?.props.name;
            return <li>{typeof name === "string" ? name : "missing"}</li>;
          }}
        </NodeBillboard.Labels>
      </NodeBillboard>,
    );

    await waitFor(() => {
      expect(container.textContent).toContain("Ada");
    });
  });

  test("injected properties skip fetch", async () => {
    const getMemoryPreview = mock(async () => {
      throw new Error("should not fetch");
    });
    const client = createMockReactClient({ getMemoryPreview });
    const { container } = mount(
      client,
      <NodeBillboard point={point} open properties={{ injected: true }}>
        <NodeBillboard.Metadata />
      </NodeBillboard>,
    );

    await waitFor(() => {
      expect(container.textContent).toContain("injected");
    });
    expect(getMemoryPreview).not.toHaveBeenCalled();
  });

  test("GraphNodeBillboardOntology uses preview-merged labels", async () => {
    const getMemoryPreview = mock(async () => ({
      key: "n1",
      namespace: "acme",
      labels: [{ kind: "event", props: {} }],
      content: [],
      properties: null,
      suppressed: false,
    }));
    const client = createMockReactClient({ getMemoryPreview });
    const { container } = mount(
      client,
      <NodeBillboard point={point} open>
        <GraphNodeBillboardOntology />
      </NodeBillboard>,
    );

    await waitFor(() => {
      expect(container.textContent).toContain("Person");
      expect(container.textContent).toContain("Event");
    });
  });
});

describe("EdgeBillboard", () => {
  test("Labels kinds-only; Metadata render prop gets properties", async () => {
    const getEdgePreview = mock(async () => ({
      edgeId: "e1",
      fromKey: "a",
      toKey: "b",
      labels: [{ kind: "knows", props: { since: 2020 } }],
      properties: { weight: 3 },
      suppressed: false,
    }));
    const client = createMockReactClient({ getEdgePreview });
    const { container } = mount(
      client,
      <EdgeBillboard edge={edge} open>
        <EdgeBillboard.Labels />
        <EdgeBillboard.Metadata>
          {(ctx) => <span>{`w=${String(ctx.properties?.weight)}`}</span>}
        </EdgeBillboard.Metadata>
      </EdgeBillboard>,
    );

    await waitFor(() => {
      expect(container.textContent).toContain("knows");
      expect(container.textContent).toContain("w=3");
    });
    expect(container.textContent).not.toContain("2020");
  });
});
