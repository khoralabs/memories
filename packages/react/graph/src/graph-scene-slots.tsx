import {
  Children,
  createContext,
  isValidElement,
  type PropsWithChildren,
  type ReactNode,
  useContext,
} from "react";
import type { GraphSceneEdgeItem, GraphSceneNodeItem } from "./projection-types.js";

export function GraphSceneTopLeft({ children: _children }: PropsWithChildren) {
  return null;
}
GraphSceneTopLeft.displayName = "GraphScene.TopLeft";

export function GraphSceneTopRight({ children: _children }: PropsWithChildren) {
  return null;
}
GraphSceneTopRight.displayName = "GraphScene.TopRight";

export function GraphSceneBottomLeft({ children: _children }: PropsWithChildren) {
  return null;
}
GraphSceneBottomLeft.displayName = "GraphScene.BottomLeft";

export function GraphSceneBottomRight({ children: _children }: PropsWithChildren) {
  return null;
}
GraphSceneBottomRight.displayName = "GraphScene.BottomRight";

export function GraphSceneCenter({ children: _children }: PropsWithChildren) {
  return null;
}
GraphSceneCenter.displayName = "GraphScene.Center";

export type GraphSceneNodeRender = (node: GraphSceneNodeItem) => ReactNode;
export type GraphSceneEdgeRender = (edge: GraphSceneEdgeItem) => ReactNode;

/** Slot: supply a render prop for each graph node (invoked inside the R3F canvas). */
export function GraphSceneNodes({ children: _children }: { children: GraphSceneNodeRender }) {
  return null;
}
GraphSceneNodes.displayName = "GraphScene.Nodes";

/** Slot: supply a render prop for each graph edge (invoked inside the R3F canvas). */
export function GraphSceneEdges({ children: _children }: { children: GraphSceneEdgeRender }) {
  return null;
}
GraphSceneEdges.displayName = "GraphScene.Edges";

export type GraphScenePartitionedSlots = {
  topLeft: ReactNode;
  topRight: ReactNode;
  bottomLeft: ReactNode;
  bottomRight: ReactNode;
  center: ReactNode;
  nodesRender: GraphSceneNodeRender | null;
  edgesRender: GraphSceneEdgeRender | null;
};

export function partitionGraphSceneChildren(
  children: ReactNode | undefined,
): GraphScenePartitionedSlots {
  const slots: GraphScenePartitionedSlots = {
    topLeft: null,
    topRight: null,
    bottomLeft: null,
    bottomRight: null,
    center: null,
    nodesRender: null,
    edgesRender: null,
  };
  if (children == null) return slots;
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const t = child.type;
    if (t === GraphSceneTopLeft) {
      slots.topLeft = (child.props as PropsWithChildren).children;
    } else if (t === GraphSceneTopRight) {
      slots.topRight = (child.props as PropsWithChildren).children;
    } else if (t === GraphSceneBottomLeft) {
      slots.bottomLeft = (child.props as PropsWithChildren).children;
    } else if (t === GraphSceneBottomRight) {
      slots.bottomRight = (child.props as PropsWithChildren).children;
    } else if (t === GraphSceneCenter) {
      slots.center = (child.props as PropsWithChildren).children;
    } else if (t === GraphSceneNodes) {
      const render = (child.props as { children: GraphSceneNodeRender }).children;
      if (typeof render === "function") slots.nodesRender = render;
    } else if (t === GraphSceneEdges) {
      const render = (child.props as { children: GraphSceneEdgeRender }).children;
      if (typeof render === "function") slots.edgesRender = render;
    }
  });
  return slots;
}

export type GraphSceneRenderContextValue = {
  nodesRender: GraphSceneNodeRender | null;
  edgesRender: GraphSceneEdgeRender | null;
  nodeLabelsVisible: boolean;
  searchHitPreviews: boolean;
  tooltipCentroid: readonly [number, number, number];
};

const GraphSceneRenderContext = createContext<GraphSceneRenderContextValue | null>(null);

export function GraphSceneRenderProvider({
  value,
  children,
}: {
  value: GraphSceneRenderContextValue;
  children: ReactNode;
}) {
  return (
    <GraphSceneRenderContext.Provider value={value}>{children}</GraphSceneRenderContext.Provider>
  );
}

export function useGraphSceneRender(): GraphSceneRenderContextValue {
  const ctx = useContext(GraphSceneRenderContext);
  if (ctx == null) {
    throw new Error("useGraphSceneRender must be used within GraphScene");
  }
  return ctx;
}
