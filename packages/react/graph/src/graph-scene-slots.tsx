import { Children, isValidElement, type PropsWithChildren, type ReactNode } from "react";

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

export type GraphScenePartitionedSlots = {
  topLeft: ReactNode;
  topRight: ReactNode;
  bottomLeft: ReactNode;
  bottomRight: ReactNode;
  center: ReactNode;
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
  };
  if (children == null) return slots;
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const { children: slotChildren } = child.props as PropsWithChildren;
    const t = child.type;
    if (t === GraphSceneTopLeft) slots.topLeft = slotChildren;
    else if (t === GraphSceneTopRight) slots.topRight = slotChildren;
    else if (t === GraphSceneBottomLeft) slots.bottomLeft = slotChildren;
    else if (t === GraphSceneBottomRight) slots.bottomRight = slotChildren;
    else if (t === GraphSceneCenter) slots.center = slotChildren;
  });
  return slots;
}
